-- Two-stage swap consent: target employee must explicitly accept or
-- reject before a manager can apply the swap.
ALTER TABLE "shift_swap_requests" ADD COLUMN "targetRespondedAt" TIMESTAMP(3);
ALTER TABLE "shift_swap_requests" ADD COLUMN "targetApproved" BOOLEAN;
