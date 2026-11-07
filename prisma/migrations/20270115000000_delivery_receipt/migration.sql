-- Delivery receipt (#delivery-receipt): what the deliverer verified, what it
-- did not, and what the reviewer should test, as JSON on the delivery.
ALTER TABLE "Delivery" ADD COLUMN "receipt" JSONB;
