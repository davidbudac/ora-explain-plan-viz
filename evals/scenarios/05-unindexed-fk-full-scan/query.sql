SELECT /* eval 05 */ p.label, c.detail
FROM eval_parent p
JOIN eval_child c ON c.parent_id = p.parent_id
WHERE p.parent_id = 42;
