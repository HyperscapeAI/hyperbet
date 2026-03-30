import json
import os
from eth_account import Account
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from hyperbet_sdk.types import (
    CreateOrderParams,
    CancelOrderParams,
    ClaimParams,
    ORDER_FLAG_GTC,
    ORDER_FLAG_IOC,
    ORDER_FLAG_POST_ONLY,
    SIDE_BID,
    SIDE_ASK,
    MARKET_KIND_DUEL_WINNER,
)

# Load ABIs
ABI_DIR = os.path.join(os.path.dirname(__file__), "abi")
with open(os.path.join(ABI_DIR, "GoldClob.json")) as f:
    CLOB_ABI = json.load(f)["abi"]
with open(os.path.join(ABI_DIR, "DuelOutcomeOracle.json")) as f:
    ORACLE_ABI = json.load(f)["abi"]

class HyperbetEVMClient:
    def __init__(self, rpc_url: str, private_key: str, clob_address: str, oracle_address: str):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        self.account = Account.from_key(private_key)
        
        self.clob = self.w3.eth.contract(address=self.w3.to_checksum_address(clob_address), abi=CLOB_ABI)
        self.oracle = self.w3.eth.contract(address=self.w3.to_checksum_address(oracle_address), abi=ORACLE_ABI)

    def _get_tx_params(self, value=0):
        return {
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "value": value,
            # Let web3 automatically estimate gas and fees if omitted, but provide baseline for local nets
        }

    def _sign_and_send(self, func_call, tx_params):
        built_tx = func_call.build_transaction(tx_params)
        signed_tx = self.w3.eth.account.sign_transaction(built_tx, private_key=self.account.key)
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction) # type: ignore
        return self.w3.eth.wait_for_transaction_receipt(tx_hash)

    def _encode_order_flags(self, time_in_force: str, post_only: bool) -> int:
        if time_in_force == "ioc":
            if post_only:
                raise ValueError("post_only orders must use time_in_force='gtc'")
            return ORDER_FLAG_IOC
        return ORDER_FLAG_GTC | ORDER_FLAG_POST_ONLY if post_only else ORDER_FLAG_GTC

    def place_order(self, params: CreateOrderParams):
        duel_key = Web3.keccak(text=params.duel_id)
        side_int = SIDE_BID if params.side == "buy" else SIDE_ASK
        order_flags = self._encode_order_flags(
            params.time_in_force,
            params.post_only,
        )
        
        treasury_fee_bps = self.clob.functions.tradeTreasuryFeeBps().call()
        mm_fee_bps = self.clob.functions.tradeMarketMakerFeeBps().call()

        price_component = params.price if params.side == "buy" else 1000 - params.price
        nominal_cost = (params.amount * price_component) // 1000
        
        treasury_fee = (nominal_cost * treasury_fee_bps) // 10000
        mm_fee = (nominal_cost * mm_fee_bps) // 10000
        total_value = nominal_cost + treasury_fee + mm_fee

        func_call = self.clob.functions.placeOrder(
            duel_key,
            MARKET_KIND_DUEL_WINNER,
            side_int,
            params.price,
            params.amount,
            order_flags,
        )
        
        return self._sign_and_send(func_call, self._get_tx_params(value=total_value + 1000))

    def cancel_order(self, params: CancelOrderParams):
        duel_key = Web3.keccak(text=params.duel_id)
        func_call = self.clob.functions.cancelOrder(duel_key, MARKET_KIND_DUEL_WINNER, params.order_id)
        return self._sign_and_send(func_call, self._get_tx_params())

    def claim(self, params: ClaimParams):
        duel_key = Web3.keccak(text=params.duel_id)
        func_call = self.clob.functions.claim(duel_key, MARKET_KIND_DUEL_WINNER)
        return self._sign_and_send(func_call, self._get_tx_params())
