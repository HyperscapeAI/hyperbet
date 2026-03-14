const { BN } = require("bn.js");

function u64Le(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

const betIdNumStr = "f9a805a41b2e61ff"; // random 8 bytes
const betIdNum = BigInt(`0x${betIdNumStr}`);
const betIdBn = new BN(betIdNum.toString());

const buf1 = u64Le(betIdNum);
const buf2 = betIdBn.toArrayLike(Buffer, "le", 8);

console.log("u64Le:", buf1);
console.log("toArrayLike:", buf2);
console.log("Identical?", buf1.equals(buf2));
