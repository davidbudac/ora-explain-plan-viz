import { useEffect, useRef, useMemo, useCallback, useState, useReducer } from 'react';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyNode, SankeyLink } from 'd3-sankey';
import { usePlan } from '../../hooks/usePlanContext';
import { COLOR_SCHEME_PALETTES, getCategoryPaint, getOperationCategory } from '../../lib/types';
import type { PlanNode } from '../../lib/types';
import { formatNumberShort, formatTimeCompact } from '../../lib/format';
import { matchesSearch } from '../../lib/filtering';
import { FOCUS_RING } from '../ui';

/** Minimum vertical pixels per operation before the diagram grows past the container and scrolls. */
const MIN_PX_PER_NODE = 22;
/** Vertical breathing room reserved for the top/bottom nodes' labels. */
const LABEL_GUTTER = 20;
/**
 * d3-sankey sizes nodes strictly in proportion to their value, so a 1-row
 * root next to a 160K-row flow collapses to a sub-pixel sliver. Nodes are
 * drawn at least this tall (centred on their layout slot; links still attach
 * to the layout position) so every operation stays visible and focusable.
 */
const MIN_NODE_HEIGHT = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface SankeyNodeExtra {
  name: string;
  planNode: PlanNode;
  category: string;
  /** The operation's own value for the active metric (null for the root statement, which has none). */
  ownValue: number | null;
}

interface SankeyLinkExtra {
  value: number;
}

type SNode = SankeyNode<SankeyNodeExtra, SankeyLinkExtra>;
type SLink = SankeyLink<SankeyNodeExtra, SankeyLinkExtra>;

export function SankeyView() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [error, setError] = useReducer((_current: string | null, next: string | null) => next, null);
  // Bumped by the error card's "Try again" button to force a redraw
  const [retryToken, setRetryToken] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  const tooltipStateRef = useRef<typeof tooltip>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTooltipRef = useRef<typeof tooltip>(null);
  const { parsedPlan, selectedNodeIds, selectNode, sankeyMetric, filteredNodeIds, theme, colorScheme, filters } = usePlan();
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  // Vertical stretch factor — thin nodes on large plans become readable by growing the drawing height
  const [verticalZoom, setVerticalZoom] = useState(1);
  const searchText = filters.searchText;

  useEffect(() => {
    tooltipStateRef.current = tooltip;
  }, [tooltip]);

  const scheduleTooltipUpdate = useCallback((next: typeof tooltip | null) => {
    pendingTooltipRef.current = next;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setTooltip(pendingTooltipRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Escape deselects — same behavior as the tree and tabular views
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((event.target as HTMLElement)?.isContentEditable) return;
      if (selectedNodeIds.length === 0) return;
      event.preventDefault();
      selectNode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNodeIds.length, selectNode]);

  // Track the container's own size (not just the window's) so opening or
  // closing a side panel re-fits the diagram. ResizeObserver also fires once
  // on observe(), which covers the initial measurement.
  const hasPlan = Boolean(parsedPlan?.rootNode);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setDimensions((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPlan]);

  const sankeyData = useMemo(() => {
    if (!parsedPlan?.rootNode) {
      return null;
    }

    const rootNode = parsedPlan.rootNode;
    const nodes: SankeyNodeExtra[] = [];
    const links: { source: string; target: string; value: number }[] = [];

    function traverse(node: PlanNode) {
      nodes.push({
        name: `${node.id}: ${node.operation}${node.objectName ? ` (${node.objectName})` : ''}`,
        planNode: node,
        category: getOperationCategory(node.operation),
        ownValue: node === rootNode ? null : getMetricValue(node, sankeyMetric),
      });

      for (const child of node.children) {
        traverse(child);
      }
    }

    traverse(rootNode);

    // Create links from parent to children using string IDs
    function createLinks(node: PlanNode) {
      for (const child of node.children) {
        const value = getMetricValue(child, sankeyMetric);

        links.push({
          source: node.id.toString(),
          target: child.id.toString(),
          value,
        });

        createLinks(child);
      }
    }

    createLinks(rootNode);

    return { nodes, links };
  }, [parsedPlan, sankeyMetric]);

  const handleNodeClick = useCallback(
    (nodeId: number, additive: boolean) => {
      selectNode(nodeId, { additive });
    },
    [selectNode]
  );

  // Clear the tooltip/error whenever the diagram is actually about to be
  // redrawn below (same trigger set as that effect's dependency array, minus
  // `svgRef` which can't be read during render). Moved out of the effect
  // because unconditionally calling setState synchronously in an effect body
  // trips react-hooks/set-state-in-effect; adjusting state during render in
  // response to a changed value is the sanctioned alternative.
  const redrawSignature = useMemo(() => {
    if (!sankeyData || dimensions.width < 100 || dimensions.height < 100) return null;
    // `scheduleTooltipUpdate` wraps ref reads/writes, so it's deliberately not
    // embedded in the returned signature (that would make this value itself
    // read as a potential render-time ref access) — just marked "used" so
    // exhaustive-deps doesn't flag it as unnecessary.
    void scheduleTooltipUpdate;
    // The array itself (a fresh reference whenever any dep below changes) is
    // the signature — its contents aren't inspected elsewhere.
    return [
      sankeyData, selectedNodeIdSet, filteredNodeIds, handleNodeClick, theme,
      dimensions, colorScheme, sankeyMetric, parsedPlan?.hasActualStats,
      verticalZoom, searchText, retryToken,
    ];
  }, [sankeyData, selectedNodeIdSet, filteredNodeIds, handleNodeClick, theme, dimensions, colorScheme, sankeyMetric, parsedPlan?.hasActualStats, scheduleTooltipUpdate, verticalZoom, searchText, retryToken]);
  const [prevRedrawSignature, setPrevRedrawSignature] = useState(redrawSignature);
  if (redrawSignature !== prevRedrawSignature) {
    setPrevRedrawSignature(redrawSignature);
    if (redrawSignature !== null) {
      setTooltip(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (!svgRef.current || !sankeyData) return;

    const { width, height: containerHeight } = dimensions;
    if (width < 100 || containerHeight < 100) return; // Don't render if too small

    // Grow past the container (scrollable) when the plan is large or the user zoomed in
    const height = Math.round(
      Math.max(containerHeight, sankeyData.nodes.length * MIN_PX_PER_NODE) * verticalZoom
    );

    pendingTooltipRef.current = null;

    try {
      const margin = { top: 20, right: 20, bottom: 20, left: 20 };

      const svg = svgRef.current;
      const palette = COLOR_SCHEME_PALETTES[colorScheme];
      const isDark = theme === 'dark';
      const hasActualStats = parsedPlan?.hasActualStats ?? false;
      const metricName = getMetricShortLabel(sankeyMetric, hasActualStats);
      const focusColor = isDark ? '#93c5fd' : '#1d4ed8';

      // Redrawing replaces every element, so a node that had keyboard focus
      // (e.g. the one just selected with Enter) is re-focused afterwards.
      const active = document.activeElement;
      const restoreFocusId = active && svg.contains(active) ? (active as SVGElement).dataset?.nodeId ?? null : null;

      svg.innerHTML = '';
      svg.setAttribute('width', width.toString());
      svg.setAttribute('height', height.toString());

      /** Focus indicator drawn a few px outside the node; shown for keyboard focus only. */
      const createFocusRing = (x: number, y: number, w: number, h: number) => {
        const ring = document.createElementNS(SVG_NS, 'rect');
        ring.setAttribute('x', (x - 3).toString());
        ring.setAttribute('y', (y - 3).toString());
        ring.setAttribute('width', (w + 6).toString());
        ring.setAttribute('height', (h + 6).toString());
        ring.setAttribute('rx', '5');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', focusColor);
        ring.setAttribute('stroke-width', '2');
        ring.style.display = 'none';
        ring.style.pointerEvents = 'none';
        return ring;
      };

      /**
       * Shared node behaviour: button semantics + accessible name, select on
       * click / Enter / Space, and the tooltip on hover and on keyboard focus.
       */
      const wireNode = (
        rect: SVGRectElement,
        ring: SVGRectElement,
        planNode: PlanNode,
        isSelected: boolean,
        valueText: string
      ) => {
        const ariaLabel =
          `#${planNode.id} ${planNode.operation}${planNode.objectName ? ` ${planNode.objectName}` : ''}, ${metricName} ${valueText}`;
        rect.dataset.nodeId = String(planNode.id);
        rect.setAttribute('tabindex', '0');
        rect.setAttribute('role', 'button');
        rect.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        rect.setAttribute('aria-label', ariaLabel);
        rect.style.cursor = 'pointer';
        rect.style.outline = 'none';

        rect.addEventListener('click', (event) => {
          handleNodeClick(planNode.id, event.metaKey || event.ctrlKey);
        });

        rect.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          handleNodeClick(planNode.id, event.metaKey || event.ctrlKey);
        });

        rect.addEventListener('focus', () => {
          // Mouse clicks also focus the node; only keyboard focus gets the ring + tooltip
          if (!isKeyboardFocus(rect)) return;
          ring.style.display = '';
          const box = rect.getBoundingClientRect();
          const containerRect = containerRef.current?.getBoundingClientRect();
          const left = containerRect?.left ?? 0;
          const top = containerRect?.top ?? 0;
          // Keep the (max 280px) tooltip inside the pane
          const maxX = Math.max(0, (containerRect?.width ?? 0) - 300);
          scheduleTooltipUpdate({
            x: Math.min(box.right - left - 8, maxX),
            y: box.top - top,
            title: planNode.operation,
            lines: buildNodeTooltipLines(planNode, metricName, valueText, hasActualStats),
          });
        });

        rect.addEventListener('blur', () => {
          ring.style.display = 'none';
          scheduleTooltipUpdate(null);
        });

        rect.addEventListener('mouseenter', (event) => {
          const containerRect = containerRef.current?.getBoundingClientRect();
          scheduleTooltipUpdate({
            x: event.clientX - (containerRect?.left ?? 0),
            y: event.clientY - (containerRect?.top ?? 0),
            title: planNode.operation,
            lines: buildNodeTooltipLines(planNode, metricName, valueText, hasActualStats),
          });
        });

        rect.addEventListener('mousemove', (event) => {
          const current = tooltipStateRef.current;
          if (!current) return;
          const containerRect = containerRef.current?.getBoundingClientRect();
          scheduleTooltipUpdate({
            ...current,
            x: event.clientX - (containerRect?.left ?? 0),
            y: event.clientY - (containerRect?.top ?? 0),
          });
        });

        rect.addEventListener('mouseleave', () => {
          scheduleTooltipUpdate(null);
        });
      };

      const restoreFocus = () => {
        if (!restoreFocusId) return;
        svg.querySelector<SVGRectElement>(`rect[data-node-id="${restoreFocusId}"]`)?.focus({ preventScroll: true });
      };

      // Check if we have valid links
      if (sankeyData.links.length === 0) {
        // No links - just show nodes vertically
        const g = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(g);

        const nodeHeight = Math.min(40, (height - 40) / sankeyData.nodes.length);
        sankeyData.nodes.forEach((node, i) => {
          const y = margin.top + i * (nodeHeight + 10);
          const rect = document.createElementNS(SVG_NS, 'rect');
          rect.setAttribute('x', margin.left.toString());
          rect.setAttribute('y', y.toString());
          rect.setAttribute('width', '20');
          rect.setAttribute('height', nodeHeight.toString());
          const paint = getCategoryPaint(node.category, colorScheme, isDark);
          rect.setAttribute('fill', paint.fill);
          if (isDark) {
            rect.setAttribute('stroke', paint.stroke);
            rect.setAttribute('stroke-width', '1');
          }
          rect.setAttribute('rx', '3');
          g.appendChild(rect);

          const ring = createFocusRing(margin.left, y, 20, nodeHeight);
          g.appendChild(ring);
          wireNode(
            rect,
            ring,
            node.planNode,
            selectedNodeIdSet.has(node.planNode.id),
            node.ownValue === null ? '—' : formatMetricValue(node.ownValue, sankeyMetric)
          );

          const text = document.createElementNS(SVG_NS, 'text');
          text.setAttribute('x', (margin.left + 30).toString());
          text.setAttribute('y', (y + nodeHeight / 2).toString());
          text.setAttribute('dy', '0.35em');
          text.setAttribute('font-size', '12');
          text.setAttribute('fill', isDark ? '#e2e8f0' : '#334155');
          text.textContent = node.name;
          g.appendChild(text);
        });
        restoreFocus();
        return;
      }

      const sankeyGenerator = sankey<SankeyNodeExtra, SankeyLinkExtra>()
        .nodeId((d) => d.planNode.id.toString())
        .nodeWidth(20)
        .nodePadding(15)
        .extent([
          // Extra vertical inset so the first/last node's label has room to sit
          // inside the viewport instead of clipping at the pane edge.
          [margin.left, margin.top + LABEL_GUTTER],
          [width - margin.right, height - margin.bottom - LABEL_GUTTER],
        ]);

      const { nodes, links } = sankeyGenerator({
        nodes: sankeyData.nodes.map((d) => ({ ...d })),
        links: sankeyData.links.map((d) => ({ ...d })),
      });

      const g = document.createElementNS(SVG_NS, 'g');
      svg.appendChild(g);

      // Draw links
      const linkGroup = document.createElementNS(SVG_NS, 'g');
      linkGroup.setAttribute('fill', 'none');
      g.appendChild(linkGroup);

      const linkPath = sankeyLinkHorizontal<SNode, SLink>();

      links.forEach((link) => {
        const sourceNode = link.source as SNode;
        const targetNode = link.target as SNode;
        const isFiltered = filteredNodeIds.has(sourceNode.planNode.id) && filteredNodeIds.has(targetNode.planNode.id);
        const linkColor = palette[sourceNode.category] || '#64748b';

        const path = document.createElementNS(SVG_NS, 'path');
        const d = linkPath(link as SLink);
        if (d) {
          path.setAttribute('d', d);
          path.setAttribute('stroke', isFiltered ? linkColor : (isDark ? '#475569' : '#cbd5e1'));
          // Dark mode: the flows are the largest painted area on the canvas, so
          // they sit back further than in light mode — otherwise they drown out
          // the tinted node surfaces and the chrome around them.
          path.setAttribute(
            'stroke-opacity',
            isFiltered ? (isDark ? '0.35' : '0.5') : (isDark ? '0.15' : '0.2')
          );
          path.setAttribute('stroke-width', Math.max(1, link.width || 1).toString());
          linkGroup.appendChild(path);

          path.addEventListener('mouseenter', (event) => {
            const label = getMetricLabel(sankeyMetric, hasActualStats);
            const containerRect = containerRef.current?.getBoundingClientRect();
            scheduleTooltipUpdate({
              x: event.clientX - (containerRect?.left ?? 0),
              y: event.clientY - (containerRect?.top ?? 0),
              title: `${sourceNode.planNode.operation} → ${targetNode.planNode.operation}`,
              lines: [
                `${label}: ${formatMetricValue(link.value || 0, sankeyMetric)}`,
              ],
            });
          });

          path.addEventListener('mousemove', (event) => {
            const current = tooltipStateRef.current;
            if (!current) return;
            const containerRect = containerRef.current?.getBoundingClientRect();
            scheduleTooltipUpdate({
              ...current,
              x: event.clientX - (containerRect?.left ?? 0),
              y: event.clientY - (containerRect?.top ?? 0),
            });
          });

          path.addEventListener('mouseleave', () => {
            scheduleTooltipUpdate(null);
          });
        }
      });

      // Draw nodes
      const nodeGroup = document.createElementNS(SVG_NS, 'g');
      g.appendChild(nodeGroup);

      nodes.forEach((node) => {
        const sNode = node as SNode;
        const isFiltered = filteredNodeIds.has(sNode.planNode.id);
        const isSelected = selectedNodeIdSet.has(sNode.planNode.id);

        const x0 = node.x0 || 0;
        const nodeWidth = (node.x1 || 0) - x0;
        if (nodeWidth <= 0) return;

        // Heights are proportional to the node's flow (d3-sankey scales every
        // column by the same factor). Give slivers a visible minimum, centred
        // on the layout slot so the links still line up.
        const layoutHeight = Math.max(0, (node.y1 || 0) - (node.y0 || 0));
        const drawHeight = Math.max(MIN_NODE_HEIGHT, layoutHeight);
        const drawY = (node.y0 || 0) - (drawHeight - layoutHeight) / 2;

        const valueText = formatMetricValue(sNode.ownValue ?? node.value ?? 0, sankeyMetric);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x0.toString());
        rect.setAttribute('y', drawY.toString());
        rect.setAttribute('width', nodeWidth.toString());
        rect.setAttribute('height', drawHeight.toString());
        const paint = getCategoryPaint(sNode.category, colorScheme, isDark);
        rect.setAttribute('fill', isFiltered ? paint.fill : (isDark ? '#475569' : '#94a3b8'));
        rect.setAttribute('opacity', isFiltered ? '1' : '0.4');
        rect.setAttribute('rx', '3');

        // Dark mode: hue hairline around the tinted surface. Selection and
        // search strokes below take precedence.
        if (isDark && isFiltered) {
          rect.setAttribute('stroke', paint.stroke);
          rect.setAttribute('stroke-width', '1');
        }

        if (isSelected) {
          rect.setAttribute('stroke', '#3b82f6');
          rect.setAttribute('stroke-width', '3');
        } else if (searchText.trim() && matchesSearch(sNode.planNode, searchText)) {
          // Search-match highlight — dashed variant of the selection stroke
          rect.setAttribute('stroke', '#3b82f6');
          rect.setAttribute('stroke-width', '2');
          rect.setAttribute('stroke-dasharray', '4 2');
        }

        const ring = createFocusRing(x0, drawY, nodeWidth, drawHeight);
        wireNode(rect, ring, sNode.planNode, isSelected, valueText);

        nodeGroup.appendChild(rect);
        nodeGroup.appendChild(ring);

        // Add label (the collision pass below drops any that would overlap)
        const text = document.createElementNS(SVG_NS, 'text');
        const isLeft = x0 < width / 2;
        text.setAttribute('x', (isLeft ? (node.x1 || 0) + 6 : x0 - 6).toString());
        text.setAttribute('y', (drawY + drawHeight / 2).toString());
        text.setAttribute('dy', '0.35em');
        text.setAttribute('text-anchor', isLeft ? 'start' : 'end');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-family', 'system-ui, sans-serif');
        text.setAttribute('fill', isDark ? '#e2e8f0' : '#334155');
        text.setAttribute('opacity', isFiltered ? '1' : '0.5');
        // Halo in the pane's own background colour so labels stay legible
        // wherever they cross a flow.
        text.setAttribute('stroke', isDark ? '#0f172a' : '#f8fafc');
        text.setAttribute('stroke-width', '3');
        text.setAttribute('stroke-linejoin', 'round');
        text.style.paintOrder = 'stroke';
        // Show the node's value next to its name — equal-height boxes are
        // otherwise indistinguishable from each other.
        text.textContent = `${truncateText(sNode.name, 32)} · ${valueText}`;
        text.style.pointerEvents = 'none';
        text.setAttribute('aria-hidden', 'true');
        text.dataset.sankeyLabel = 'true';
        text.dataset.nodeX0 = String(x0);
        text.dataset.nodeX1 = String(node.x1 || 0);

        nodeGroup.appendChild(text);
      });

      // Label collision pass: hide any label whose box intersects an
      // already-kept one (greedy top-to-bottom). Hidden labels stay available
      // via the hover tooltip, which always leads with the operation name.
      const labels = Array.from(nodeGroup.querySelectorAll<SVGTextElement>('text[data-sankey-label]'));

      // Keep labels inside the viewport: flip the anchor inward when a label
      // would run off the left/right edge, and nudge it back in vertically.
      const EDGE_PAD = 4;
      for (const label of labels) {
        const x0 = Number(label.dataset.nodeX0 ?? 0);
        const x1 = Number(label.dataset.nodeX1 ?? 0);
        let box = label.getBBox();

        if (box.x + box.width > width - EDGE_PAD) {
          label.setAttribute('text-anchor', 'end');
          label.setAttribute('x', (x0 - 6).toString());
          box = label.getBBox();
        } else if (box.x < EDGE_PAD) {
          label.setAttribute('text-anchor', 'start');
          label.setAttribute('x', (x1 + 6).toString());
          box = label.getBBox();
        }

        const y = Number(label.getAttribute('y') ?? 0);
        if (box.y < EDGE_PAD) {
          label.setAttribute('y', (y + (EDGE_PAD - box.y)).toString());
        } else if (box.y + box.height > height - EDGE_PAD) {
          label.setAttribute('y', (y - (box.y + box.height - (height - EDGE_PAD))).toString());
        }
      }

      // Measure each label once, after the edge adjustments
      const measured = labels.map((label) => ({ label, box: label.getBBox() }));
      measured.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
      const kept: DOMRect[] = [];
      const pad = 2;
      for (const { label, box } of measured) {
        const collides = kept.some(
          (k) =>
            box.x < k.x + k.width + pad &&
            box.x + box.width + pad > k.x &&
            box.y < k.y + k.height + pad &&
            box.y + box.height + pad > k.y
        );
        if (collides) {
          label.remove();
        } else {
          kept.push(new DOMRect(box.x, box.y, box.width, box.height));
        }
      }

      restoreFocus();
    } catch (err) {
      console.error('Sankey rendering error:', err);
      setError(err instanceof Error ? err.message : 'Failed to render Sankey diagram');
    }
  }, [sankeyData, selectedNodeIdSet, filteredNodeIds, handleNodeClick, theme, dimensions, colorScheme, sankeyMetric, parsedPlan?.hasActualStats, scheduleTooltipUpdate, verticalZoom, searchText, retryToken]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
        No plan loaded yet. Paste an execution plan in the input panel and press Parse.
      </div>
    );
  }

  const metricCaption = getMetricShortLabel(sankeyMetric, parsedPlan.hasActualStats ?? false);

  return (
    <div className="relative w-full h-full" style={{ minHeight: '400px' }}>
      <div ref={containerRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <svg ref={svgRef} className="block w-full" role="group" aria-label={`Sankey diagram of the execution plan, sized by ${metricCaption}`} />
      </div>
      {/* The metric switch lives in the filter panel, so say what the boxes mean here too */}
      <div
        className="absolute top-2 left-3 z-10 pointer-events-none rounded-md border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 shadow-sm"
        title="Box height and flow width are proportional to the metric value. Change the metric in the Filters panel."
      >
        Metric: <span className="font-semibold text-slate-800 dark:text-slate-100">{metricCaption}</span>
      </div>
      {error && (
        <div role="alert" className="absolute inset-0 z-30 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 p-4">
          <div className="max-w-sm rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-800 p-4 shadow-md text-sm">
            <div className="font-semibold text-red-700 dark:text-red-300">Couldn&apos;t draw the Sankey diagram</div>
            <p className="mt-1 break-words text-slate-600 dark:text-slate-300">{error}</p>
            <button
              type="button"
              onClick={() => setRetryToken((t) => t + 1)}
              className={`mt-3 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-600 ${FOCUS_RING}`}
            >
              Try again
            </button>
          </div>
        </div>
      )}
      {/* Vertical zoom controls */}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setVerticalZoom((z) => Math.min(8, z * 1.4))}
          className={`h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm text-sm font-bold ${FOCUS_RING}`}
          title="Stretch diagram vertically (makes thin operations readable)"
          aria-label="Stretch diagram vertically"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setVerticalZoom((z) => Math.max(1, z / 1.4))}
          disabled={verticalZoom <= 1}
          className={`h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm text-sm font-bold disabled:opacity-40 ${FOCUS_RING}`}
          title="Shrink diagram vertically"
          aria-label="Shrink diagram vertically"
        >
          −
        </button>
        {verticalZoom > 1 && (
          <button
            type="button"
            onClick={() => setVerticalZoom(1)}
            className={`h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm text-[10px] font-bold ${FOCUS_RING}`}
            title="Reset vertical zoom"
            aria-label="Reset vertical zoom"
          >
            1:1
          </button>
        )}
      </div>
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-100"
          style={{
            left: `${tooltip.x + 12}px`,
            top: `${tooltip.y + 12}px`,
            maxWidth: '280px',
          }}
        >
          <div className="font-semibold mb-1">{tooltip.title}</div>
          <div className="space-y-0.5">
            {tooltip.lines.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The value a plan node contributes to the diagram for the active metric. */
function getMetricValue(node: PlanNode, metric: string): number {
  switch (metric) {
    case 'cost':
      return Math.max(node.cost || 1, 1);
    case 'actualRows':
      // A-Rows is already cumulative over all starts; without actuals use the
      // total estimate (E-Rows × starts).
      return Math.max(
        node.actualRows ?? node.estimatedRowsTotal ?? (node.rows ?? 1) * (node.starts ?? 1),
        1
      );
    case 'actualTime':
      return Math.max(node.actualTime || 1, 1);
    case 'rows':
    default:
      return Math.max(node.rows || 1, 1);
  }
}

/** Short metric name for the caption, tooltips and accessible names. */
function getMetricShortLabel(metric: string, hasActualStats: boolean): string {
  switch (metric) {
    case 'cost':
      return 'Cost';
    case 'actualRows':
      return 'Total rows';
    case 'actualTime':
      return 'A-Time';
    case 'rows':
    default:
      return hasActualStats ? 'E-Rows' : 'Rows';
  }
}

/** True when the element is focused in a way the browser would draw a focus ring for (keyboard, not mouse). */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

function buildNodeTooltipLines(
  planNode: PlanNode,
  metricName: string,
  valueText: string,
  hasActualStats: boolean
): string[] {
  const lines = [
    planNode.objectName ? `Object: ${planNode.objectName}` : null,
    `Cost: ${formatNumberShort(planNode.cost, { empty: '—' })}`,
    planNode.rows !== undefined ? `E-Rows: ${formatNumberShort(planNode.rows)}` : null,
  ].filter(Boolean) as string[];

  if (hasActualStats) {
    if (planNode.actualRows !== undefined) {
      lines.push(`A-Rows: ${formatNumberShort(planNode.actualRows)}`);
    }
    if (planNode.actualTime !== undefined) {
      lines.push(`A-Time: ${formatTimeCompact(planNode.actualTime)}`);
    }
  }
  lines.push(`Box size (${metricName}): ${valueText}`);
  return lines;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function getMetricLabel(metric: string, hasActualStats: boolean): string {
  switch (metric) {
    case 'rows':
      return hasActualStats ? 'E-Rows' : 'Rows';
    case 'cost':
      return 'Cost';
    case 'actualRows':
      return 'Total rows (all starts)';
    case 'actualTime':
      return 'A-Time';
    default:
      return 'Rows';
  }
}

function formatMetricValue(value: number, metric: string): string {
  if (metric === 'actualTime') return formatTimeCompact(value) ?? '—';
  return formatNumberShort(value, { empty: '—' }) ?? '—';
}
