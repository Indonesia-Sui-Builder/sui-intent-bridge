// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/IntentVault.sol";

contract DeployIntentVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY_EVM");
        // Constructor Arguments for Base Sepolia
        address usdc = vm.envAddress("MOCK_USDC_ADDRESS");
        address wormhole = 0x79A1027a6A159502049F10906D333EC57E95F083; // Real Base Sepolia Wormhole Core (Verified)

        // This is the Sui Emitter Cap ID (Object ID from register_emitter event)
        bytes32 suiEmitter = vm.envBytes32("SUI_EMITTER_CAP_ID");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_EVM"));

        IntentVault vault = new IntentVault(usdc, wormhole, suiEmitter);

        console.log("IntentVault deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
