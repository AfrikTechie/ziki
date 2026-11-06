-- Live · Published (D1): where marketing work goes when a manager accepts it.
-- Its own migration: Postgres can't use a new enum value in the transaction
-- that adds it. It sits after on_prod because the enum's order is the workflow order.
ALTER TYPE "Substatus" ADD VALUE IF NOT EXISTS 'published' AFTER 'on_prod';
