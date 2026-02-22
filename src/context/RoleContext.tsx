import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '@stratos-wallet/sdk';
import { roleAPI } from '../services/api';

export type UserRole = 'fund' | 'primebroker' | null;

interface RoleContextType {
  role: UserRole;
  isFund: boolean;
  isPrimeBroker: boolean;
  isOperator: boolean;
  hasOperator: boolean;
  loading: boolean;
  assignRole: (partyId: string, role: 'fund' | 'primebroker') => Promise<void>;
  removeRole: (partyId: string) => Promise<void>;
  becomeOperator: () => Promise<void>;
  allRoles: Record<string, string>;
  refreshRoles: () => Promise<void>;
}

const RoleContext = createContext<RoleContextType>({
  role: null,
  isFund: false,
  isPrimeBroker: false,
  isOperator: false,
  hasOperator: false,
  loading: true,
  assignRole: async () => {},
  removeRole: async () => {},
  becomeOperator: async () => {},
  allRoles: {},
  refreshRoles: async () => {},
});

export function useRole() {
  return useContext(RoleContext);
}

// Map Canton role enum to our UserRole type
function cantonRoleToUserRole(cantonRole: string | null): UserRole {
  if (!cantonRole) return null;
  if (cantonRole === 'PrimeBroker') return 'primebroker';
  if (cantonRole === 'Fund') return 'fund';
  // Fallback for KV-stored roles
  if (cantonRole === 'primebroker') return 'primebroker';
  if (cantonRole === 'fund') return 'fund';
  return null;
}

export function RoleProvider({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  const [role, setRole] = useState<UserRole>(null);
  const [isOperator, setIsOperator] = useState(false);
  const [hasOperator, setHasOperator] = useState(false);
  const [allRoles, setAllRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const partyId = user?.partyId || user?.id || '';

  // Reset state when user/partyId changes
  useEffect(() => {
    setRole(null);
    setIsOperator(false);
    setHasOperator(false);
    setAllRoles({});
    setLoading(true);
  }, [partyId]);

  const refreshRoles = useCallback(async () => {
    if (!partyId) return;
    try {
      // Try Canton ledger first for role assignments
      const cantonAssignments = await roleAPI.getRoleAssignments();
      if (cantonAssignments.data.length > 0) {
        // Build allRoles from Canton contracts
        const cantonRoles: Record<string, string> = {};
        for (const a of cantonAssignments.data) {
          cantonRoles[a.party] = cantonRoleToUserRole(a.role) || a.role;
        }
        setAllRoles(cantonRoles);
        setRole(cantonRoleToUserRole(cantonRoles[partyId] || null));
      } else {
        // Fallback to KV API
        const roleRes = await fetch(`/api/roles?partyId=${encodeURIComponent(partyId)}`);
        const roleData = await roleRes.json() as { role?: string };
        setRole((roleData.role as UserRole) || null);

        const allRes = await fetch('/api/roles');
        const allData = await allRes.json() as { roles?: Record<string, string> };
        setAllRoles(allData.roles || {});
      }

      // Check if an operator exists and if current user is the operator
      const configRes = await fetch('/api/config');
      const configData = await configRes.json() as { operatorParty?: string };
      setHasOperator(!!configData.operatorParty);
      setIsOperator(configData.operatorParty === partyId);
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    refreshRoles();
  }, [refreshRoles]);

  const becomeOperator = useCallback(async () => {
    try {
      // Register as operator in KV config
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorParty: partyId }),
      });
      // Create OperatorRole contract on Canton ledger
      await roleAPI.createOperatorRole(partyId);
    } catch (err) {
      console.warn('Failed to create operator role on Canton:', err);
    }
    await refreshRoles();
  }, [partyId, refreshRoles]);

  const assignRole = useCallback(async (targetPartyId: string, newRole: 'fund' | 'primebroker') => {
    // Try Canton ledger first
    try {
      if (newRole === 'primebroker') {
        // Operator assigns primebroker
        const operatorRole = await roleAPI.getOperatorRole(partyId);
        if (operatorRole.data.contractId) {
          await roleAPI.assignPrimeBroker(operatorRole.data.contractId, targetPartyId);
          // Also create BrokerRole contract for the new broker
          await roleAPI.createBrokerRole(targetPartyId, partyId);
        }
      } else if (newRole === 'fund') {
        // Check if current user is a broker with a BrokerRole contract
        const brokerRole = await roleAPI.getBrokerRole(partyId);
        if (brokerRole.data.contractId) {
          await roleAPI.brokerAssignFund(brokerRole.data.contractId, targetPartyId);
        } else {
          // Operator assigning fund directly
          const operatorRole = await roleAPI.getOperatorRole(partyId);
          if (operatorRole.data.contractId) {
            await roleAPI.assignFund(operatorRole.data.contractId, targetPartyId);
          }
        }
      }
    } catch (err) {
      console.warn('Canton role assignment failed, falling back to KV:', err);
    }

    // Also persist to KV as fallback
    await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyId: targetPartyId, role: newRole, requestingParty: partyId }),
    });
    await refreshRoles();
  }, [partyId, refreshRoles]);

  const removeRole = useCallback(async (targetPartyId: string) => {
    // Try Canton ledger first
    try {
      const targetRole = await roleAPI.getRoleForParty(targetPartyId);
      if (targetRole.data.contractId) {
        await roleAPI.revokeRole(targetRole.data.contractId);
      }
    } catch (err) {
      console.warn('Canton role revocation failed, falling back to KV:', err);
    }

    // Also remove from KV
    await fetch('/api/roles', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyId: targetPartyId, requestingParty: partyId }),
    });
    await refreshRoles();
  }, [partyId, refreshRoles]);

  return (
    <RoleContext.Provider
      value={{
        role,
        isFund: role === 'fund',
        isPrimeBroker: role === 'primebroker',
        isOperator,
        hasOperator,
        loading,
        assignRole,
        removeRole,
        becomeOperator,
        allRoles,
        refreshRoles,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}
