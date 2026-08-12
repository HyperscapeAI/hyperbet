type SolanaOrderConfirmationQuoteState = {
  confirmationKey: string | null;
  currentQuoteKey: string | null;
  orderSubmissionReady: boolean;
  submissionInProgress: boolean;
};

/**
 * Keep the reviewed quote valid while its transaction is already in flight.
 * Live order-book updates must not turn a signing/confirmation state into a
 * misleading pre-submit "quote changed" warning.
 */
export function isSolanaOrderConfirmationQuoteCurrent({
  confirmationKey,
  currentQuoteKey,
  orderSubmissionReady,
  submissionInProgress,
}: SolanaOrderConfirmationQuoteState): boolean {
  if (confirmationKey == null) return false;
  if (submissionInProgress) return true;
  return confirmationKey === currentQuoteKey && orderSubmissionReady;
}
