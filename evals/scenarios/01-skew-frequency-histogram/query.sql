SELECT /* eval 01 */ SUM(amount)
FROM eval_orders
WHERE status = 'PROCESSED';
