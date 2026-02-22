// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * DepositRelay — Shared deposit pool contract (one per chain).
 *
 * Breaks on-chain traceability between depositor and vault escrow.
 * Funds deposit ETH/ERC20 into the pool; the operator forwards to
 * individual vault escrows in batches.
 *
 * Events intentionally omit msg.sender for privacy.
 */
contract DepositRelay {
    address public immutable operator;

    event ETHDeposited(uint256 amount);
    event ERC20Deposited(address indexed token, uint256 amount);
    event ETHForwarded(address indexed to, uint256 amount);
    event ERC20Forwarded(address indexed token, address indexed to, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    constructor(address _operator) {
        operator = _operator;
    }

    /// @notice Accept native ETH deposits (privacy: no sender logged)
    receive() external payable {
        emit ETHDeposited(msg.value);
    }

    /// @notice Deposit ERC20 tokens into the relay pool
    function depositERC20(address token, uint256 amount) external {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount) // transferFrom(address,address,uint256)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ERC20 transferFrom failed");
        emit ERC20Deposited(token, amount);
    }

    /// @notice Forward ETH from pool to a vault escrow (operator only)
    function forwardETH(address to, uint256 amount) external onlyOperator {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit ETHForwarded(to, amount);
    }

    /// @notice Forward ERC20 tokens from pool to a vault escrow (operator only)
    function forwardERC20(address token, address to, uint256 amount) external onlyOperator {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer(address,uint256)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ERC20 transfer failed");
        emit ERC20Forwarded(token, to, amount);
    }

    /// @notice Returns the contract's ETH balance
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
