// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {
    ICoreBridge,
    CoreBridgeVM
} from "wormhole-solidity-sdk/interfaces/ICoreBridge.sol";

contract IntentVault {
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
        uint256 amount;
        bytes32 recipientSui;
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
        uint256 amount,
        bytes32 recipientSui
    );
    event OrderSettled(
        uint256 indexed orderId,
        address indexed solver,
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

    constructor(address _usdc, address _wormhole, bytes32 _suiContractAddress) {
        usdc = IERC20(_usdc);
        wormhole = ICoreBridge(_wormhole);
        suiContractAddress = _suiContractAddress;
    }

    /**
     * @notice Creates a cross-chain intent order by locking USDC
     * @param amount Amount of USDC to bridge
     * @param recipientSui Recipient address on Sui (32 bytes)
     */
    function createOrder(uint256 amount, bytes32 recipientSui) external {
        require(amount > 0, "Amount must be > 0");

        // Transfer USDC from user to this contract
        bool success = usdc.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();

        uint256 orderId = nextOrderId++;

        orders[orderId] = CrossChainOrder({
            depositor: msg.sender,
            amount: amount,
            recipientSui: recipientSui,
            status: OrderStatus.PENDING
        });

        emit OrderCreated(orderId, msg.sender, amount, recipientSui);
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

        // 4. Decode Payload (Format: [orderId(32 bytes), solverAddress(32 bytes)])
        (uint256 orderId, ) = abi.decode(vm.payload, (uint256, bytes32));

        // 5. Validate Order
        CrossChainOrder storage order = orders[orderId];
        if (order.amount == 0) revert InvalidOrder();
        if (order.status != OrderStatus.PENDING) revert OrderAlreadySettled();

        // 6. Update State
        order.status = OrderStatus.SETTLED;

        // 7. Transfer Funds to Solver (msg.sender)
        // The solver proves they fulfilled the intent by providing the VAA
        bool success = usdc.transfer(msg.sender, order.amount);
        if (!success) revert TransferFailed();

        emit OrderSettled(orderId, msg.sender, vm.hash);
    }

    /**
     * @notice Fulfills a Sui intent by paying the user on EVM and emitting a Wormhole message
     * @dev This generates the VAA needed to claim the locked SUI on the Sui network.
     * @param intentId The Sui object ID of the intent (32 bytes)
     * @param recipient The EVM address of the user (who expects the ETH)
     * @param solverSuiAddress The Sui address of the solver (who will claim the repayment)
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
        // We include the solver's Sui Address so that only they can claim the funds on Sui.
        // Payload: [intentId (32 bytes), solverSuiAddress (32 bytes)]
        bytes memory payload = abi.encode(intentId, solverSuiAddress);

        // 3. Publish Wormhole Message
        // nonce = 0, consistencyLevel = 1 (Instant/Fast)
        sequence = wormhole.publishMessage{value: fee}(0, payload, 1);
    }
}
