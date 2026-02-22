// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * VaultEscrow — Per-vault escrow contract for EVM assets.
 *
 * Deployed per vault. The deployer (msg.sender) becomes the immutable owner
 * and is the only party that can withdraw ETH or ERC20 tokens.
 * A separate immutable liquidator address can seize assets during liquidation.
 *
 * On liquidation, ETH is wrapped to WETH and swapped to USDC via Uniswap V3,
 * then sent directly to the broker. This eliminates price risk for the broker.
 */
contract VaultEscrow {
    address public immutable owner;
    address public immutable liquidator;
    address public immutable swapRouter;
    address public immutable weth;
    address public immutable stablecoin;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Liquidated(address indexed to, uint256 ethAmount, uint256 stablecoinAmount);

    constructor(address _liquidator, address _swapRouter, address _weth, address _stablecoin) {
        owner = msg.sender;
        liquidator = _liquidator;
        swapRouter = _swapRouter;
        weth = _weth;
        stablecoin = _stablecoin;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyLiquidator() {
        require(msg.sender == liquidator, "Not liquidator");
        _;
    }

    /// @notice Accept native ETH deposits
    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw native ETH to `to`
    function withdrawETH(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit Withdrawn(to, amount);
    }

    /// @notice Withdraw ERC20 tokens to `to`
    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer(address,uint256)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ERC20 transfer failed");
        emit Withdrawn(to, amount);
    }

    /// @notice Liquidate native ETH — wrap to WETH, swap to USDC via Uniswap V3, send to broker
    function liquidate(address to, uint256 amount, uint256 amountOutMinimum) external onlyLiquidator {
        require(address(this).balance >= amount, "Insufficient balance");

        // 1. Wrap ETH → WETH
        IWETH(weth).deposit{value: amount}();

        // 2. Approve router to spend WETH
        IWETH(weth).approve(swapRouter, amount);

        // 3. Swap WETH → stablecoin via Uniswap V3
        uint256 amountOut = ISwapRouter(swapRouter).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: stablecoin,
                fee: 3000, // 0.3% pool
                recipient: to,
                amountIn: amount,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        emit Liquidated(to, amount, amountOut);
    }

    /// @notice Liquidate ERC20 tokens — send to broker
    function liquidateERC20(address token, address to, uint256 amount) external onlyLiquidator {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer(address,uint256)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ERC20 transfer failed");
        emit Liquidated(to, amount, 0);
    }

    /// @notice Returns the contract's ETH balance
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
