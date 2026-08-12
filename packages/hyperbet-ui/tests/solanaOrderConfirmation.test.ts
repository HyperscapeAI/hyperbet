import { describe, expect, test } from "bun:test";

import { isSolanaOrderConfirmationQuoteCurrent } from "../src/lib/solanaOrderConfirmation";

describe("isSolanaOrderConfirmationQuoteCurrent", () => {
  test("requires a current, submission-ready quote before signing", () => {
    expect(
      isSolanaOrderConfirmationQuoteCurrent({
        confirmationKey: "quote-a",
        currentQuoteKey: "quote-a",
        orderSubmissionReady: true,
        submissionInProgress: false,
      }),
    ).toBe(true);
    expect(
      isSolanaOrderConfirmationQuoteCurrent({
        confirmationKey: "quote-a",
        currentQuoteKey: "quote-b",
        orderSubmissionReady: true,
        submissionInProgress: false,
      }),
    ).toBe(false);
    expect(
      isSolanaOrderConfirmationQuoteCurrent({
        confirmationKey: "quote-a",
        currentQuoteKey: "quote-a",
        orderSubmissionReady: false,
        submissionInProgress: false,
      }),
    ).toBe(false);
  });

  test("does not label an already-submitted transaction as a stale quote", () => {
    expect(
      isSolanaOrderConfirmationQuoteCurrent({
        confirmationKey: "reviewed-quote",
        currentQuoteKey: "updated-live-quote",
        orderSubmissionReady: false,
        submissionInProgress: true,
      }),
    ).toBe(true);
  });

  test("returns false when no confirmation is open", () => {
    expect(
      isSolanaOrderConfirmationQuoteCurrent({
        confirmationKey: null,
        currentQuoteKey: "quote-a",
        orderSubmissionReady: true,
        submissionInProgress: true,
      }),
    ).toBe(false);
  });
});
