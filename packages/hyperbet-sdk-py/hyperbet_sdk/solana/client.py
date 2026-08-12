import json
import os
from typing import Any
from urllib.parse import urlsplit

import base58
from anchorpy import Context, Program, Provider, Wallet
from anchorpy_core.idl import (
    Idl,
    IdlAccount,
    IdlEnumVariant,
    IdlErrorCode,
    IdlField,
    IdlInstruction,
    IdlTypeArray,
    IdlTypeDefined,
    IdlTypeDefinition,
    IdlTypeDefinitionTyEnum,
    IdlTypeDefinitionTyStruct,
    IdlTypeOption,
    IdlTypeSimple,
    IdlTypeVec,
)
from solana.rpc.async_api import AsyncClient
from solders.instruction import AccountMeta  # type: ignore
from solders.keypair import Keypair  # type: ignore
from solders.pubkey import Pubkey  # type: ignore
from solders.system_program import ID as SYS_PROGRAM_ID  # type: ignore

from hyperbet_sdk.types import (
    MARKET_KIND_DUEL_WINNER,
    MAX_MATCHES_PER_TRANSACTION,
    ORDER_BEHAVIOR_GTC,
    ORDER_BEHAVIOR_IOC,
    ORDER_BEHAVIOR_POST_ONLY,
    SIDE_ASK,
    SIDE_BID,
    CancelOrderParams,
    ClaimParams,
    CloseFilledOrderParams,
    CloseLosingBalanceParams,
    CreateOrderParams,
    ReclaimOrderParams,
)

IDL_DIR = os.path.join(os.path.dirname(__file__), "idl")


def _rpc_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Solana RPC URL must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("Solana RPC URL must not contain credentials")
    return value


def _field(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        if name not in value:
            raise ValueError(f"Account is missing {name}")
        return value[name]
    if not hasattr(value, name):
        raise ValueError(f"Account is missing {name}")
    return getattr(value, name)


def _program_int(value: Any, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} is not a valid program integer") from exc
    if parsed < 0:
        raise ValueError(f"{label} cannot be negative")
    return parsed


def _pubkey(value: Any, label: str) -> Pubkey:
    if isinstance(value, Pubkey):
        return value
    try:
        return Pubkey.from_string(str(value))
    except ValueError as exc:
        raise ValueError(f"{label} is not a valid Solana address") from exc


_IDL_SIMPLE_TYPES = {
    "bool": IdlTypeSimple.Bool,
    "u8": IdlTypeSimple.U8,
    "i8": IdlTypeSimple.I8,
    "u16": IdlTypeSimple.U16,
    "i16": IdlTypeSimple.I16,
    "u32": IdlTypeSimple.U32,
    "i32": IdlTypeSimple.I32,
    "f32": IdlTypeSimple.F32,
    "u64": IdlTypeSimple.U64,
    "i64": IdlTypeSimple.I64,
    "f64": IdlTypeSimple.F64,
    "u128": IdlTypeSimple.U128,
    "i128": IdlTypeSimple.I128,
    "u256": IdlTypeSimple.U256,
    "i256": IdlTypeSimple.I256,
    "bytes": IdlTypeSimple.Bytes,
    "string": IdlTypeSimple.String,
    "pubkey": IdlTypeSimple.PublicKey,
}


def _legacy_idl_type(value: Any):
    if isinstance(value, str):
        try:
            return _IDL_SIMPLE_TYPES[value]
        except KeyError as exc:
            raise ValueError(f"Unsupported IDL scalar type: {value}") from exc
    if not isinstance(value, dict):
        raise ValueError("IDL type must be a scalar or object")
    if "option" in value:
        return IdlTypeOption(_legacy_idl_type(value["option"]))
    if "vec" in value:
        return IdlTypeVec(_legacy_idl_type(value["vec"]))
    if "array" in value:
        element, length = value["array"]
        return IdlTypeArray((_legacy_idl_type(element), int(length)))
    if "defined" in value:
        defined = value["defined"]
        name = defined["name"] if isinstance(defined, dict) else defined
        return IdlTypeDefined(str(name))
    raise ValueError(f"Unsupported IDL type shape: {value}")


def _legacy_type_definition(value: dict[str, Any]) -> IdlTypeDefinition:
    definition = value["type"]
    kind = definition["kind"]
    if kind == "struct":
        fields = [
            IdlField(
                field["name"],
                field.get("docs"),
                _legacy_idl_type(field["type"]),
            )
            for field in definition.get("fields", [])
        ]
        body = IdlTypeDefinitionTyStruct(fields)
    elif kind == "enum":
        variants = []
        for variant in definition.get("variants", []):
            if variant.get("fields"):
                raise ValueError("Tuple or named enum payloads are not supported")
            variants.append(IdlEnumVariant(variant["name"], None))
        body = IdlTypeDefinitionTyEnum(variants)
    else:
        raise ValueError(f"Unsupported IDL definition kind: {kind}")
    return IdlTypeDefinition(value["name"], value.get("docs"), body)


def _legacy_idl_from_new(value: dict[str, Any]) -> Idl:
    metadata = value.get("metadata") or {}
    all_types = {
        definition["name"]: _legacy_type_definition(definition)
        for definition in value.get("types", [])
    }
    account_names = [account["name"] for account in value.get("accounts", [])]
    accounts = []
    for name in account_names:
        if name not in all_types:
            raise ValueError(f"IDL account {name} has no matching type definition")
        accounts.append(all_types[name])

    instructions = []
    for instruction in value.get("instructions", []):
        instruction_accounts = [
            IdlAccount(
                account["name"],
                bool(account.get("writable", False)),
                bool(account.get("signer", False)),
                bool(account["optional"]) if "optional" in account else None,
                account.get("docs"),
                None,
                [],
            )
            for account in instruction.get("accounts", [])
        ]
        args = [
            IdlField(arg["name"], arg.get("docs"), _legacy_idl_type(arg["type"]))
            for arg in instruction.get("args", [])
        ]
        instructions.append(
            IdlInstruction(
                instruction["name"],
                instruction.get("docs"),
                instruction_accounts,
                args,
                _legacy_idl_type(instruction["returns"])
                if "returns" in instruction
                else None,
            )
        )

    errors = [
        IdlErrorCode(error["code"], error["name"], error.get("msg"))
        for error in value.get("errors", [])
    ]
    non_account_types = [
        definition
        for name, definition in all_types.items()
        if name not in set(account_names)
    ]
    return Idl(
        metadata.get("version", "0.1.0"),
        metadata.get("name", "hyperbet_program"),
        value.get("docs"),
        [],
        instructions,
        accounts,
        non_account_types,
        None,
        errors or None,
        {"address": value.get("address"), **metadata},
    )


def _load_idl(name: str) -> Idl:
    with open(os.path.join(IDL_DIR, name), encoding="utf-8") as handle:
        return _legacy_idl_from_new(json.load(handle))


def duel_key_hex_to_bytes(duel_key_hex: str) -> bytes:
    normalized = duel_key_hex.strip().lower()
    if len(normalized) != 64:
        raise ValueError("duel_key_hex must be a 32-byte hex string")
    try:
        return bytes.fromhex(normalized)
    except ValueError as exc:
        raise ValueError("duel_key_hex must be a 32-byte hex string") from exc


def find_duel_state_pda(fight_oracle_program_id: Pubkey, duel_key: bytes) -> Pubkey:
    return Pubkey.find_program_address([b"duel", duel_key], fight_oracle_program_id)[0]


def find_market_state_pda(duel_market_program_id: Pubkey, duel_state: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"market", bytes(duel_state), bytes([MARKET_KIND_DUEL_WINNER])],
        duel_market_program_id,
    )[0]


def find_market_config_pda(duel_market_program_id: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"config"], duel_market_program_id)[0]


def find_vault_pda(duel_market_program_id: Pubkey, market_state: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"vault", bytes(market_state)], duel_market_program_id
    )[0]


def find_user_balance_pda(
    duel_market_program_id: Pubkey, market_state: Pubkey, owner: Pubkey
) -> Pubkey:
    return Pubkey.find_program_address(
        [b"balance", bytes(market_state), bytes(owner)], duel_market_program_id
    )[0]


def find_order_pda(
    duel_market_program_id: Pubkey, market_state: Pubkey, order_id: int
) -> Pubkey:
    if order_id < 0 or order_id > 18_446_744_073_709_551_615:
        raise ValueError("Order ID is outside the program u64 range")
    return Pubkey.find_program_address(
        [b"order", bytes(market_state), order_id.to_bytes(8, "little")],
        duel_market_program_id,
    )[0]


def find_price_level_pda(
    duel_market_program_id: Pubkey,
    market_state: Pubkey,
    side: int,
    price: int,
) -> Pubkey:
    if side not in {SIDE_BID, SIDE_ASK}:
        raise ValueError("Order side must be the program bid or ask value")
    if price <= 0 or price >= 1_000:
        raise ValueError("Program price must be an integer from 1 to 999")
    return Pubkey.find_program_address(
        [
            b"level",
            bytes(market_state),
            bytes([side]),
            price.to_bytes(2, "little"),
        ],
        duel_market_program_id,
    )[0]


def _order_behavior(value: str) -> int:
    return {
        "GTC": ORDER_BEHAVIOR_GTC,
        "IOC": ORDER_BEHAVIOR_IOC,
        "POST_ONLY": ORDER_BEHAVIOR_POST_ONLY,
    }[value]


class HyperbetSolanaClient:
    def __init__(
        self,
        rpc_url: str,
        private_key_base58: str,
        duel_market_program_id: str,
        fight_oracle_program_id: str,
    ):
        self.client = AsyncClient(_rpc_url(rpc_url))
        self.keypair = Keypair.from_bytes(base58.b58decode(private_key_base58))
        self.wallet = Wallet(self.keypair)
        self.provider = Provider(self.client, self.wallet)
        self.duel_market_program_id = Pubkey.from_string(duel_market_program_id)
        self.fight_oracle_program_id = Pubkey.from_string(fight_oracle_program_id)
        self.duel_market_program = Program(
            _load_idl("duel_market.json"),
            self.duel_market_program_id,
            self.provider,
        )
        self.fight_oracle_program = Program(
            _load_idl("fight_oracle.json"),
            self.fight_oracle_program_id,
            self.provider,
        )

    def get_duel_state_pda(self, duel_key: bytes) -> Pubkey:
        return find_duel_state_pda(self.fight_oracle_program_id, duel_key)

    def get_market_pda(self, duel_state: Pubkey) -> Pubkey:
        return find_market_state_pda(self.duel_market_program_id, duel_state)

    def get_market_config_pda(self) -> Pubkey:
        return find_market_config_pda(self.duel_market_program_id)

    def get_vault_pda(self, market_state: Pubkey) -> Pubkey:
        return find_vault_pda(self.duel_market_program_id, market_state)

    def get_user_balance_pda(self, market_state: Pubkey) -> Pubkey:
        return find_user_balance_pda(
            self.duel_market_program_id, market_state, self.keypair.pubkey()
        )

    async def _resolve_market(self, duel_key_hex: str) -> tuple[Pubkey, Pubkey, Any]:
        duel_state = self.get_duel_state_pda(duel_key_hex_to_bytes(duel_key_hex))
        market_state = self.get_market_pda(duel_state)
        duel_account = await self.fight_oracle_program.account["DuelState"].fetch(
            duel_state
        )
        market_account = await self.duel_market_program.account["MarketState"].fetch(
            market_state
        )
        if duel_account is None:
            raise ValueError("Canonical duel account is unavailable")
        market_duel_state = _pubkey(
            _field(market_account, "duel_state"), "Market duel state"
        )
        if market_duel_state != duel_state:
            raise ValueError("Market does not reference the canonical duel PDA")
        if (
            _program_int(_field(market_account, "market_kind"), "Market kind")
            != MARKET_KIND_DUEL_WINNER
        ):
            raise ValueError("Market is not the canonical duel-winner market")
        return duel_state, market_state, market_account

    async def _place_order_remaining_accounts(
        self,
        market_state: Pubkey,
        side: int,
        price: int,
        amount: int,
        behavior: int,
    ) -> list[AccountMeta]:
        opposite_side = SIDE_ASK if side == SIDE_BID else SIDE_BID
        all_levels = await self.duel_market_program.account["PriceLevel"].all()
        levels: list[Any] = []
        for entry in all_levels:
            account = _field(entry, "account")
            level_price = _program_int(_field(account, "price"), "Price-level price")
            if (
                _pubkey(_field(account, "market_state"), "Price-level market")
                == market_state
                and _program_int(_field(account, "side"), "Price-level side")
                == opposite_side
                and _program_int(
                    _field(account, "total_open"), "Price-level open amount"
                )
                > 0
                and (level_price <= price if side == SIDE_BID else level_price >= price)
            ):
                levels.append(entry)
        levels.sort(
            key=lambda entry: _program_int(
                _field(_field(entry, "account"), "price"), "Price-level price"
            ),
            reverse=side == SIDE_ASK,
        )

        metas: list[AccountMeta] = []
        remaining = amount
        matches = 0
        self_trade_prevented = False
        for entry in levels:
            if remaining <= 0 or matches >= MAX_MATCHES_PER_TRANSACTION:
                break
            level = _field(entry, "account")
            level_price = _program_int(_field(level, "price"), "Price-level price")
            level_pda = find_price_level_pda(
                self.duel_market_program_id,
                market_state,
                opposite_side,
                level_price,
            )
            if _pubkey(_field(entry, "public_key"), "Price-level account") != level_pda:
                raise ValueError("Price-level account does not match its canonical PDA")
            metas.append(AccountMeta(level_pda, False, True))
            current_order_id = _program_int(
                _field(level, "head_order_id"), "Price-level head"
            )
            level_open = _program_int(
                _field(level, "total_open"), "Price-level open amount"
            )
            if current_order_id == 0 or level_open == 0:
                raise ValueError("Active price level has an empty linked-list boundary")

            while (
                remaining > 0
                and current_order_id > 0
                and level_open > 0
                and matches < MAX_MATCHES_PER_TRANSACTION
            ):
                order_pda = find_order_pda(
                    self.duel_market_program_id, market_state, current_order_id
                )
                order = await self.duel_market_program.account["Order"].fetch(order_pda)
                if (
                    _pubkey(_field(order, "market_state"), "Order market")
                    != market_state
                    or _program_int(_field(order, "id"), "Order ID") != current_order_id
                    or _program_int(_field(order, "side"), "Order side")
                    != opposite_side
                    or _program_int(_field(order, "price"), "Order price")
                    != level_price
                    or not bool(_field(order, "active"))
                ):
                    raise ValueError(
                        "Order book changed while building the transaction"
                    )
                maker = _pubkey(_field(order, "maker"), "Order maker")
                metas.extend(
                    [
                        AccountMeta(order_pda, False, True),
                        AccountMeta(
                            find_user_balance_pda(
                                self.duel_market_program_id, market_state, maker
                            ),
                            False,
                            True,
                        ),
                    ]
                )
                if maker == self.keypair.pubkey():
                    self_trade_prevented = True
                    break
                order_amount = _program_int(_field(order, "amount"), "Order amount")
                order_filled = _program_int(
                    _field(order, "filled"), "Order filled amount"
                )
                if order_filled >= order_amount:
                    raise ValueError("Active order has no remaining amount")
                order_remaining = order_amount - order_filled
                fill = min(order_remaining, remaining)
                remaining -= fill
                level_open -= fill
                matches += 1
                if remaining <= 0 or fill < order_remaining:
                    break
                current_order_id = _program_int(
                    _field(order, "next_order_id"), "Next order ID"
                )
                if current_order_id > 0 and level_open > 0:
                    metas.append(AccountMeta(level_pda, False, True))
                elif current_order_id != 0 or level_open != 0:
                    raise ValueError("Price-level linked-list totals are inconsistent")
            if self_trade_prevented:
                break

        should_rest = (
            remaining > 0
            and not self_trade_prevented
            and matches < MAX_MATCHES_PER_TRANSACTION
            and behavior != ORDER_BEHAVIOR_IOC
        )
        if should_rest:
            resting_level_pda = find_price_level_pda(
                self.duel_market_program_id, market_state, side, price
            )
            resting_level = await self.duel_market_program.account[
                "PriceLevel"
            ].fetch_nullable(resting_level_pda)
            if resting_level is not None:
                tail_order_id = _program_int(
                    _field(resting_level, "tail_order_id"),
                    "Resting price-level tail",
                )
                if tail_order_id > 0:
                    metas.append(
                        AccountMeta(
                            find_order_pda(
                                self.duel_market_program_id,
                                market_state,
                                tail_order_id,
                            ),
                            False,
                            True,
                        )
                    )
        return metas

    async def place_order(self, params: CreateOrderParams):
        duel_state, market_state, market_account = await self._resolve_market(
            params.duel_key_hex
        )
        side = SIDE_BID if params.side == "YES" else SIDE_ASK
        price = (
            params.outcome_price_millis
            if params.side == "YES"
            else 1_000 - params.outcome_price_millis
        )
        behavior = _order_behavior(params.behavior)
        order_id = _program_int(
            _field(market_account, "next_order_id"), "Next order ID"
        )
        remaining_accounts = await self._place_order_remaining_accounts(
            market_state,
            side,
            price,
            params.amount_lamports,
            behavior,
        )
        return await self.duel_market_program.rpc["place_order"](
            order_id,
            side,
            price,
            params.amount_lamports,
            behavior,
            ctx=Context(
                accounts={
                    "market_state": market_state,
                    "duel_state": duel_state,
                    "user_balance": self.get_user_balance_pda(market_state),
                    "new_order": find_order_pda(
                        self.duel_market_program_id, market_state, order_id
                    ),
                    "resting_level": find_price_level_pda(
                        self.duel_market_program_id, market_state, side, price
                    ),
                    "config": self.get_market_config_pda(),
                    "treasury": _pubkey(
                        _field(market_account, "treasury"), "Market treasury"
                    ),
                    "market_maker": _pubkey(
                        _field(market_account, "market_maker"),
                        "Market maker recipient",
                    ),
                    "vault": self.get_vault_pda(market_state),
                    "user": self.keypair.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                },
                remaining_accounts=remaining_accounts,
            ),
        )

    async def _managed_order_context(
        self, params: CancelOrderParams | ReclaimOrderParams
    ) -> tuple[Pubkey, Pubkey, Pubkey, Pubkey, int, int, list[AccountMeta]]:
        duel_state, market_state, _ = await self._resolve_market(params.duel_key_hex)
        order_pda = find_order_pda(
            self.duel_market_program_id, market_state, params.order_id
        )
        order = await self.duel_market_program.account["Order"].fetch(order_pda)
        side = _program_int(_field(order, "side"), "Order side")
        price = _program_int(_field(order, "price"), "Order price")
        if (
            _program_int(_field(order, "id"), "Order ID") != params.order_id
            or _pubkey(_field(order, "market_state"), "Order market") != market_state
            or _pubkey(_field(order, "maker"), "Order maker") != self.keypair.pubkey()
            or not bool(_field(order, "active"))
        ):
            raise ValueError("Order is not an active order owned by this wallet")
        level_pda = find_price_level_pda(
            self.duel_market_program_id, market_state, side, price
        )
        level = await self.duel_market_program.account["PriceLevel"].fetch(level_pda)
        if (
            _pubkey(_field(level, "market_state"), "Price-level market") != market_state
            or _program_int(_field(level, "side"), "Price-level side") != side
            or _program_int(_field(level, "price"), "Price-level price") != price
        ):
            raise ValueError("Price level no longer matches the selected order")
        adjacent: list[AccountMeta] = []
        previous_id = _program_int(_field(order, "prev_order_id"), "Previous order ID")
        next_id = _program_int(_field(order, "next_order_id"), "Next order ID")
        for adjacent_id, link_name, expected_link in [
            (previous_id, "next_order_id", params.order_id),
            (next_id, "prev_order_id", params.order_id),
        ]:
            if adjacent_id == 0:
                continue
            adjacent_pda = find_order_pda(
                self.duel_market_program_id, market_state, adjacent_id
            )
            adjacent_order = await self.duel_market_program.account["Order"].fetch(
                adjacent_pda
            )
            if (
                _program_int(_field(adjacent_order, "id"), "Adjacent order ID")
                != adjacent_id
                or _pubkey(
                    _field(adjacent_order, "market_state"), "Adjacent order market"
                )
                != market_state
                or _program_int(_field(adjacent_order, "side"), "Adjacent order side")
                != side
                or _program_int(_field(adjacent_order, "price"), "Adjacent order price")
                != price
                or not bool(_field(adjacent_order, "active"))
                or _program_int(
                    _field(adjacent_order, link_name), "Adjacent order link"
                )
                != expected_link
            ):
                raise ValueError("Linked order changed while building the transaction")
            adjacent.append(AccountMeta(adjacent_pda, False, True))
        return (
            duel_state,
            market_state,
            order_pda,
            level_pda,
            side,
            price,
            adjacent,
        )

    async def _submit_order_action(
        self,
        params: CancelOrderParams | ReclaimOrderParams,
        instruction: str,
    ):
        (
            duel_state,
            market_state,
            order_pda,
            level_pda,
            side,
            price,
            adjacent,
        ) = await self._managed_order_context(params)
        return await self.duel_market_program.rpc[instruction](
            params.order_id,
            side,
            price,
            ctx=Context(
                accounts={
                    "market_state": market_state,
                    "duel_state": duel_state,
                    "order": order_pda,
                    "price_level": level_pda,
                    "vault": self.get_vault_pda(market_state),
                    "user": self.keypair.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                },
                remaining_accounts=adjacent,
            ),
        )

    async def cancel_order(self, params: CancelOrderParams):
        return await self._submit_order_action(params, "cancel_order")

    async def reclaim_order(self, params: ReclaimOrderParams):
        return await self._submit_order_action(params, "reclaim_resting_order")

    async def close_filled_order(self, params: CloseFilledOrderParams):
        _, market_state, _ = await self._resolve_market(params.duel_key_hex)
        order_pda = find_order_pda(
            self.duel_market_program_id, market_state, params.order_id
        )
        order = await self.duel_market_program.account["Order"].fetch(order_pda)
        if (
            _pubkey(_field(order, "maker"), "Order maker") != self.keypair.pubkey()
            or bool(_field(order, "active"))
            or _program_int(_field(order, "filled"), "Filled amount")
            != _program_int(_field(order, "amount"), "Order amount")
            or _program_int(_field(order, "prev_order_id"), "Previous order ID") != 0
            or _program_int(_field(order, "next_order_id"), "Next order ID") != 0
            or bool(_field(order, "continuation_pending"))
        ):
            raise ValueError("Order is not eligible for filled-order rent cleanup")
        return await self.duel_market_program.rpc["close_filled_order"](
            params.order_id,
            ctx=Context(
                accounts={
                    "market_state": market_state,
                    "order": order_pda,
                    "user": self.keypair.pubkey(),
                }
            ),
        )

    async def claim(self, params: ClaimParams):
        duel_state, market_state, market_account = await self._resolve_market(
            params.duel_key_hex
        )
        return await self.duel_market_program.rpc["claim"](
            ctx=Context(
                accounts={
                    "market_state": market_state,
                    "duel_state": duel_state,
                    "user_balance": self.get_user_balance_pda(market_state),
                    "config": self.get_market_config_pda(),
                    "market_maker": _pubkey(
                        _field(market_account, "market_maker"),
                        "Market maker recipient",
                    ),
                    "vault": self.get_vault_pda(market_state),
                    "user": self.keypair.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                }
            )
        )

    async def close_losing_balance(self, params: CloseLosingBalanceParams):
        duel_state, market_state, _ = await self._resolve_market(params.duel_key_hex)
        return await self.duel_market_program.rpc["close_losing_balance"](
            ctx=Context(
                accounts={
                    "market_state": market_state,
                    "duel_state": duel_state,
                    "user_balance": self.get_user_balance_pda(market_state),
                    "user": self.keypair.pubkey(),
                }
            )
        )
