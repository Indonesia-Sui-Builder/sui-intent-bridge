// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {
    ICoreBridge,
    CoreBridgeVM
} from "wormhole-solidity-sdk/interfaces/ICoreBridge.sol";

contract IntentBridge {
    // Wormhole Chain ID for Sui is 21
    uint16 constant SUI_CHAIN_ID = 21;

    // State Variables
    IERC20 public immutable usdc;
    ICoreBridge public immutable wormhole;
    bytes32 public immutable suiContractAddress; // The emitter address on Sui

    // Order Status
    enum OrderStatus {
        PENDING,
        SETTLED,
        REFUNDED
    }

    struct CrossChainOrder {
        address depositor;
        uint256 inputAmount;
        bytes32 recipientSui;
        // Auction Params
        uint256 startOutputAmount;
        uint256 minOutputAmount;
        uint256 startTime;
        uint256 duration;
        // Status
        OrderStatus status;
    }

    // Storage
    uint256 public nextOrderId;
    mapping(uint256 => CrossChainOrder) public orders;
    mapping(bytes32 => bool) public processedVaas; // Prevent replay attacks

    // Events
    event OrderCreated(
        uint256 indexed orderId,
        address indexed depositor,
        uint256 inputAmount,
        uint256 startOutputAmount,
        uint256 minOutputAmount,
        uint256 startTime,
        uint256 duration,
        bytes32 recipientSui
    );
    event OrderSettled(
        uint256 indexed orderId,
        address indexed solver,
        uint256 amountPaidBySolver,
        bytes32 vaaHash
    );

    // Errors
    error InvalidOrder();
    error OrderAlreadySettled();
    error VAAAlreadyProcessed();
    error InvalidEmitterChain();
    error InvalidEmitterAddress();
    error InvalidVAA();
    error TransferFailed();
    error InvalidAmount();
    error BidTooLow();

    constructor(address _usdc, address _wormhole, bytes32 _suiContractAddress) {
        usdc = IERC20(_usdc);
        wormhole = ICoreBridge(_wormhole);
        suiContractAddress = _suiContractAddress;
    }

    /**
     * @notice Creates a cross-chain Dutch Auction order by locking USDC
     * @param inputAmount Amount of USDC to bridge
     * @param startOutputAmount Initial required SUI amount
     * @param minOutputAmount Minimum required SUI amount (floor)
     * @param duration Duration of the auction in seconds
     * @param recipientSui Recipient address on Sui (32 bytes)
     */
    function createOrder(
        uint256 inputAmount,
        uint256 startOutputAmount,
        uint256 minOutputAmount,
        uint256 duration,
        bytes32 recipientSui
    ) external {
        if (inputAmount == 0) revert InvalidAmount();

        // Transfer USDC from user to this contract
        bool success = usdc.transferFrom(
            msg.sender,
            address(this),
            inputAmount
        );
        if (!success) revert TransferFailed();

        uint256 orderId = nextOrderId++;

        orders[orderId] = CrossChainOrder({
            depositor: msg.sender,
            inputAmount: inputAmount,
            recipientSui: recipientSui,
            startOutputAmount: startOutputAmount,
            minOutputAmount: minOutputAmount,
            startTime: block.timestamp,
            duration: duration,
            status: OrderStatus.PENDING
        });

        emit OrderCreated(
            orderId,
            msg.sender,
            inputAmount,
            startOutputAmount,
            minOutputAmount,
            block.timestamp,
            duration,
            recipientSui
        );
    }

    /**
     * @notice Calculates the current required SUI amount based on linear decay
     * @param orderId The ID of the order
     */
    function getCurrentRequiredAmount(
        uint256 orderId
    ) public view returns (uint256) {
        CrossChainOrder memory order = orders[orderId];

        if (block.timestamp <= order.startTime) {
            return order.startOutputAmount;
        }

        uint256 elapsed = block.timestamp - order.startTime;

        if (elapsed >= order.duration) {
            return order.minOutputAmount;
        }

        // Linear Decay Formula
        uint256 totalDrop = order.startOutputAmount - order.minOutputAmount;
        uint256 decayAmount = (totalDrop * elapsed) / order.duration;

        return order.startOutputAmount - decayAmount;
    }

    /**
     * @notice Settles an order using a verified Wormhole VAA
     * @param encodedVM The signed VAA from Wormhole
     */
    function settleOrder(bytes calldata encodedVM) external {
        // 1. Verify VAA
        (CoreBridgeVM memory vm, bool valid, string memory reason) = wormhole
            .parseAndVerifyVM(encodedVM);

        require(valid, reason);

        // 2. Prevent Replay
        if (processedVaas[vm.hash]) revert VAAAlreadyProcessed();
        processedVaas[vm.hash] = true;

        // 3. Verify Emitter (Source Chain & Contract)
        if (vm.emitterChainId != SUI_CHAIN_ID) revert InvalidEmitterChain();
        if (vm.emitterAddress != suiContractAddress)
            revert InvalidEmitterAddress();

        // 4. Decode Payload (Format: [orderId(32 bytes), solverAddress(32 bytes), amountPaidBySolver(32 bytes)])
        (
            uint256 orderId,
            address solverAddress,
            uint256 amountPaidBySolver
        ) = abi.decode(vm.payload, (uint256, address, uint256));

        // 5. Validate Order
        CrossChainOrder storage order = orders[orderId];
        if (order.inputAmount == 0) revert InvalidOrder(); // Check if order exists
        if (order.status != OrderStatus.PENDING) revert OrderAlreadySettled();

        // 6. Verify Auction Logic
        // We ensure the solver satisfied the required amount AT THE TIME specified by the VAA timestamp.
        uint256 requiredAmountAtExecution = getRequiredAmountAt(
            order,
            vm.timestamp
        );
        if (amountPaidBySolver < requiredAmountAtExecution) revert BidTooLow();

        // 7. Update State
        order.status = OrderStatus.SETTLED;

        // 8. Transfer Funds to Solver
        bool success = usdc.transfer(solverAddress, order.inputAmount);
        if (!success) revert TransferFailed();

        emit OrderSettled(orderId, solverAddress, amountPaidBySolver, vm.hash);
    }

    /**
     * @notice Internal helper to calculate required amount at a specific timestamp
     */
    function getRequiredAmountAt(
        CrossChainOrder memory order,
        uint256 timestamp
    ) internal pure returns (uint256) {
        if (timestamp <= order.startTime) {
            return order.startOutputAmount;
        }

        uint256 elapsed = timestamp - order.startTime;

        if (elapsed >= order.duration) {
            return order.minOutputAmount;
        }

        uint256 totalDrop = order.startOutputAmount - order.minOutputAmount;
        uint256 decayAmount = (totalDrop * elapsed) / order.duration;

        return order.startOutputAmount - decayAmount;
    }

    /**
     * @notice Fulfills a Sui intent by paying the user on EVM and emitting a Wormhole message
     * @dev This generates the VAA needed to claim the locked SUI on the Sui network.
     * @param intentId The Sui object ID of the intent (32 bytes)
     * @param recipient The EVM address of the user (who expects the ETH)
     * @param solverSuiAddress The Sui address of the solver (who will claim the repayment)
     * @param amount The amount of ETH paid to the user
     */
    function fulfillOrder(
        bytes32 intentId,
        address payable recipient,
        bytes32 solverSuiAddress,
        uint256 amount
    ) external payable returns (uint64 sequence) {
        uint256 fee = wormhole.messageFee();
        require(
            msg.value == amount + fee,
            "Incorrect ETH amount (amount + fee)"
        );

        // 1. Pay the recipient
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH transfer failed");

        // 2. Construct Payload
        // Payload: [intentId (32 bytes), solverSuiAddress (32 bytes), amount (32 bytes)]
        // This includes 'amount' to satisfy the Dutch Auction logic on Sui.
        bytes memory payload = abi.encode(intentId, solverSuiAddress, amount);

        // 3. Publish Wormhole Message
        // nonce = 0, consistencyLevel = 0 (Instant)
        sequence = wormhole.publishMessage{value: fee}(0, payload, 0);
    }
}
