SELECT /* eval 02 */ COUNT(*), MAX(payload)
FROM eval_events
WHERE event_type BETWEEN 100 AND 400;
