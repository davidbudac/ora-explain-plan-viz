SELECT /* eval 04 */ p.po_id, SUM(l.qty * l.price)
FROM eval_po p
JOIN eval_line_items l ON l.po_id = p.po_id
WHERE p.region = 'RARE'
GROUP BY p.po_id;
