// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Define strict IWormhole interface to match requirements
interface IWormhole {
    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }

    function parseAndVerifyVM(
        bytes calldata encodedVM
    ) external view returns (VM memory vm, bool valid, string memory reason);
    function messageFee() external view returns (uint256);
    function publishMessage(
        uint32 nonce,
        bytes calldata payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);
}

contract AuctionVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Wormhole Chain ID for Sui is 21
    uint16 constant SUI_CHAIN_ID = 21;

    enum OrderStatus {
        OPEN,
        FILLED,
        CANCELLED // Optional but good practice
    }

    struct AuctionOrder {
        address depositor;
        address inputToken;
        uint256 inputAmount;
        uint256 startOutputAmount;
        uint256 minOutputAmount;
        uint256 startTime;
        uint256 duration;
        OrderStatus status;
    }

    // State Variables
    IERC20 public immutable usdc;
    IWormhole public immutable wormhole;
    // We might want to allow this to be set/updated, but immutable for now based on prompt.
    // However, usually cross-chain apps need to know the trusted emitter on the other chain.
    bytes32 public immutable suiEmitterAddress;

    uint256 public nextOrderId;
    mapping(uint256 => AuctionOrder) public orders;
    mapping(bytes32 => bool) public processedVaas; // Prevent replay attacks

    // Events
    event OrderCreated(
        uint256 indexed orderId,
        address indexed depositor,
        address inputToken,
        uint256 inputAmount,
        uint256 startOutputAmount,
        uint256 minOutputAmount,
        uint256 startTime,
        uint256 duration
    );

    event OrderSettled(
        uint256 indexed orderId,
        address indexed solver,
        uint256 amountPaidBySolver,
        uint256 requiredAmount
    );

    // Errors
    error InvalidAmount();
    error TransferFailed();
    error OrderNotFound();
    error OrderNotOpen();
    error VAAAlreadyProcessed();
    error InvalidEmitterChain();
    error InvalidEmitterAddress();
    error InvalidVAA();
    error BidTooLow();

    constructor(address _usdc, address _wormhole, bytes32 _suiEmitterAddress) {
        usdc = IERC20(_usdc);
        wormhole = IWormhole(_wormhole);
        suiEmitterAddress = _suiEmitterAddress;
    }

    function createOrder(
        uint256 inputAmount,
        uint256 startOutputAmount,
        uint256 minOutputAmount,
        uint256 duration
    ) external nonReentrant returns (uint256 orderId) {
        if (inputAmount == 0) revert InvalidAmount();

        // Transfer USDC from user to vault
        usdc.safeTransferFrom(msg.sender, address(this), inputAmount);

        orderId = nextOrderId++;

        orders[orderId] = AuctionOrder({
            depositor: msg.sender,
            inputToken: address(usdc),
            inputAmount: inputAmount,
            startOutputAmount: startOutputAmount,
            minOutputAmount: minOutputAmount,
            startTime: block.timestamp,
            duration: duration,
            status: OrderStatus.OPEN
        });

        emit OrderCreated(
            orderId,
            msg.sender,
            address(usdc),
            inputAmount,
            startOutputAmount,
            minOutputAmount,
            block.timestamp,
            duration
        );
    }

    function getCurrentRequiredAmount(
        uint256 orderId
    ) public view returns (uint256) {
        AuctionOrder memory order = orders[orderId];

        // If order doesn't exist/is invalid, return max int to prevent accidental fill?
        // Or revert. Revert is safer but prompts ask for logic.
        // Assuming valid orderId for calculation.

        if (block.timestamp <= order.startTime) {
            return order.startOutputAmount;
        }

        uint256 elapsed = block.timestamp - order.startTime;

        if (elapsed >= order.duration) {
            return order.minOutputAmount;
        }

        // Linear Decay Formula
        // decayAmount = (totalDrop * elapsed) / duration
        uint256 totalDrop = order.startOutputAmount - order.minOutputAmount;
        uint256 decayAmount = (totalDrop * elapsed) / order.duration;

        return order.startOutputAmount - decayAmount;
    }

    function settleOrder(bytes calldata encodedVM) external nonReentrant {
        // 1. Verify VAA
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole
            .parseAndVerifyVM(encodedVM);
        if (!valid) revert InvalidVAA(); // Or use reason string

        // 2. Prevent Replay
        if (processedVaas[vm.hash]) revert VAAAlreadyProcessed();
        processedVaas[vm.hash] = true;

        // 3. Verify Emitter
        if (vm.emitterChainId != SUI_CHAIN_ID) revert InvalidEmitterChain();
        if (vm.emitterAddress != suiEmitterAddress)
            revert InvalidEmitterAddress();

        // 4. Decode Payload
        // Expected Payload: [orderId (32 bytes), solverAddress (32 bytes), amountPaidBySolver (32 bytes)]
        // Note: adjust decoding based on actual payload structure on Sui side.
        // Assuming standard abi.encode-like packing or fixed bytes.
        // `abi.decode` works for standard EVM encoding.
        // Since Sui checks usually output serialized data, we assume the solver formats it to match EVM ABI.
        (
            uint256 orderId,
            address solverAddress,
            uint256 amountPaidBySolver
        ) = abi.decode(vm.payload, (uint256, address, uint256));

        // 5. Validate Order Logic
        AuctionOrder storage order = orders[orderId];

        if (order.status != OrderStatus.OPEN) revert OrderNotOpen();

        // CRITICAL: Check Price
        uint256 requiredAmount = getCurrentRequiredAmount(orderId);
        if (amountPaidBySolver < requiredAmount) revert BidTooLow();

        // 6. Update State
        order.status = OrderStatus.FILLED;

        // 7. Payout Solver
        usdc.safeTransfer(solverAddress, order.inputAmount);

        emit OrderSettled(
            orderId,
            solverAddress,
            amountPaidBySolver,
            requiredAmount
        );
    }
}
