const HINT_COMMENT_RE = /\/\*\+|--\+/;
function list(hints) {
    return hints.map((h) => `\`${h.text}\``).join(', ');
}
/**
 * Findings from the DBMS_XPLAN Hint Report (19c+) and the Note section: hints Oracle rejected
 * (syntax errors), hints it could not apply (unused, with its reason), and embedded hints that a
 * SQL plan baseline, profile or patch is likely overriding.
 */
export const hintsRule = {
    id: 'hints',
    evaluate(ctx) {
        const findings = [];
        let anyReported = false;
        for (const node of ctx.plan.allNodes) {
            const hints = node.hints ?? [];
            if (hints.length === 0)
                continue;
            anyReported = true;
            const where = node.objectAlias ? ` on ${node.objectAlias}` : node.queryBlock ? ` in ${node.queryBlock}` : '';
            const errors = hints.filter((h) => h.status === 'error');
            if (errors.length > 0) {
                findings.push({
                    ruleId: 'hint-syntax-error',
                    severity: 'warning',
                    nodeIds: [node.id],
                    title: errors.length === 1 ? `Hint has a syntax error: ${errors[0].text}` : `${errors.length} hints have syntax errors`,
                    explanation: `Oracle could not parse ${list(errors)}${where}, so ${errors.length === 1 ? 'it was' : 'they were'} ignored. A hint with a typo or an unknown name is silently dropped; the rest of the hint comment is still processed. Note that a stray word in the hint comment (a label, a comment) is reported here too and is harmless.`,
                    suggestion: 'Check the hint name and its arguments against the Oracle SQL Language Reference; if the word is a deliberate marker, leave it, otherwise fix the spelling so the hint takes effect.',
                });
            }
            const unused = hints.filter((h) => h.status === 'unused');
            if (unused.length > 0) {
                const reasons = unused.filter((h) => h.reason).map((h) => `\`${h.text}\`: ${h.reason}`);
                findings.push({
                    ruleId: 'hint-unused',
                    severity: 'warning',
                    nodeIds: [node.id],
                    title: unused.length === 1 ? `Hint not used: ${unused[0].text}` : `${unused.length} hints not used`,
                    explanation: `The optimizer recognised ${list(unused)}${where} but did not apply ${unused.length === 1 ? 'it' : 'them'}.` +
                        (reasons.length > 0 ? ` Oracle's reason: ${reasons.join('; ')}.` : '') +
                        ' Typical causes: the hint names a table or alias that does not exist in that query block, it conflicts with another hint, it asks for something the plan shape makes impossible (an index that does not cover the predicate, a join method on the driving table), or a view boundary stops it from reaching the operation.',
                    suggestion: 'Qualify the hint with the query block and alias from the "Query Block Name / Object Alias" section (e.g. INDEX(@"SEL$1" "T"@"SEL$1" idx)), or remove it if the plan is already the one you want.',
                });
            }
        }
        const notes = ctx.plan.notes;
        const hasEmbeddedHints = anyReported || (ctx.plan.sqlText !== undefined && HINT_COMMENT_RE.test(ctx.plan.sqlText));
        if (notes && hasEmbeddedHints) {
            const raw = notes.rawLines.join('\n');
            const patch = raw.match(/SQL patch "([^"]+)"/i)?.[1];
            const overrider = notes.sqlPlanBaseline
                ? { kind: 'SQL plan baseline', name: notes.sqlPlanBaseline }
                : notes.sqlProfile
                    ? { kind: 'SQL profile', name: notes.sqlProfile }
                    : patch
                        ? { kind: 'SQL patch', name: patch }
                        : notes.outline
                            ? { kind: 'stored outline', name: notes.outline }
                            : undefined;
            if (overrider) {
                findings.push({
                    ruleId: 'hints-overridden',
                    severity: 'info',
                    nodeIds: [],
                    title: `Embedded hints are overridden by ${overrider.kind} ${overrider.name}`,
                    explanation: `The statement carries hints in its text, but ${overrider.kind} "${overrider.name}" was applied to it. A baseline pins a plan, and profiles and patches inject their own hints (the plan's outline starts with IGNORE_OPTIM_EMBEDDED_HINTS), so what the statement says in its hint comment is not what decided this plan. Editing those hints will not change the plan while the ${overrider.kind} is in force.`,
                    suggestion: `To test a hint change, disable or drop the ${overrider.kind} (or run the statement with a different text so it no longer matches), then re-check the plan; if the pinned plan is the intended one, remove the hints from the SQL so the text stops suggesting otherwise.`,
                });
            }
        }
        return findings;
    },
};
