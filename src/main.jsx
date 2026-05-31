import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './styles.css';

const CANVAS = { width: 1600, height: 1050 };
const defaultPostSpacing = 8;
const postTypes = ['line', 'corner', 'end', 'gate', 'terminal', 'brace', 'custom'];
const gateTypes = ['Walk gate', 'Double gate', 'Sliding gate', 'Cantilever gate', 'Custom gate'];
const extensions = ['Standard post', 'Light-ready +12 inches', 'Light-ready +18 inches', 'Light-ready +24 inches', 'Light-ready +36 inches', 'Custom extension height'];

const tools = [
  ['upload', '⬆️', 'Upload Aerial Screenshot'],
  ['calibrate', '📏', 'Calibrate Scale'],
  ['draw', '✏️', 'Draw Fence Line'],
  ['select', '↖️', 'Select/Edit'],
  ['gate', '🚪', 'Add Gate'],
  ['post', '●', 'Add Post'],
  ['light', '💡', 'Mark Light-Ready Post'],
  ['pan', '✋', 'Pan'],
];

const emptyProject = () => ({
  meta: {
    customerName: '', projectAddress: '', phone: '', email: '', jobName: 'New Fence Plan',
    date: new Date().toISOString().slice(0, 10), fenceType: 'Metal privacy fence', customerNotes: '', internalNotes: '', wastePercent: 5,
  },
  view: { zoom: 0.62 },
  background: { dataUrl: '', opacity: 0.45, locked: false, hidden: false, x: 80, y: 70, scale: 1 },
  calibration: { pixelsPerFoot: 0, realFeet: 0, realInches: 0, line: null },
  runs: [], posts: [], gates: [], customMaterials: []
});

const uid = () => Math.random().toString(36).slice(2, 10);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const feetLabel = (feet) => {
  const totalInches = Math.max(0, Math.round(Number(feet || 0) * 12));
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return inches ? `${ft}'-${inches}"` : `${ft}'`;
};
const feetDecimal = (feet) => `${Number(feet || 0).toFixed(1)} ft`;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const unitVector = (a, b) => {
  const d = Math.max(1, dist(a, b));
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

function App() {
  const [project, setProject] = useState(() => JSON.parse(localStorage.getItem('dc-fence-autosave') || 'null') || emptyProject());
  const [tool, setTool] = useState('draw');
  const [selected, setSelected] = useState(null);
  const [draftPoint, setDraftPoint] = useState(null);
  const [calDraft, setCalDraft] = useState(null);
  const [panStart, setPanStart] = useState(null);
  const fileInput = useRef(null);
  const jsonInput = useRef(null);
  const drawingRef = useRef(null);

  const updateProject = (producer) => {
    setProject((current) => {
      const base = { ...emptyProject(), ...current, view: { ...emptyProject().view, ...(current.view || {}) }, background: { ...emptyProject().background, ...(current.background || {}) } };
      const next = typeof producer === 'function' ? producer(structuredClone(base)) : producer;
      localStorage.setItem('dc-fence-autosave', JSON.stringify(next));
      return next;
    });
  };

  const pixelsPerFoot = project.calibration.pixelsPerFoot || 12;
  const totalFeet = useMemo(() => project.runs.reduce((sum, run) => sum + runLength(run, pixelsPerFoot), 0), [project.runs, pixelsPerFoot]);
  const lpPosts = useMemo(() => labelLightPosts(project.posts), [project.posts]);
  const materials = useMemo(() => buildMaterials(project, totalFeet, lpPosts), [project, totalFeet, lpPosts]);
  const selectedRun = selected?.type === 'run' && project.runs.find((r) => r.id === selected.id);
  const selectedPost = selected?.type === 'post' && project.posts.find((p) => p.id === selected.id);
  const selectedGate = selected?.type === 'gate' && project.gates.find((g) => g.id === selected.id);

  const toWorld = (event) => {
    const rect = drawingRef.current.getBoundingClientRect();
    const zoom = project.view?.zoom || 1;
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  };

  const selectTool = (name) => {
    if (name === 'upload') return fileInput.current.click();
    setTool(name);
    setDraftPoint(null);
    setCalDraft(null);
  };

  const onCanvasDown = (event) => {
    if (event.target.closest?.('button')) return;
    const point = toWorld(event);
    if (tool === 'pan') {
      setPanStart({ point, background: { ...project.background } });
      return;
    }
    if (tool === 'calibrate') return handleCalibration(point);
    if (tool === 'post') {
      updateProject((p) => { p.posts.push(newPost(snapToNearestRun(point, p.runs), 'custom')); return p; });
      return;
    }
    if (tool === 'gate') {
      updateProject((p) => { p.gates.push(newGate(p, snapToNearestRun(point, p.runs))); return p; });
      return;
    }
    if (tool === 'draw') return handleFencePoint(point);
  };

  const handleCalibration = (point) => {
    if (!calDraft) {
      setCalDraft(point);
      return;
    }
    const realFeet = Number(prompt('Known distance: feet', project.calibration.realFeet || '10') || 0);
    const realInches = Number(prompt('Known distance: inches', project.calibration.realInches || '0') || 0);
    const real = realFeet + realInches / 12;
    if (real > 0) {
      updateProject((p) => {
        p.calibration = { pixelsPerFoot: dist(calDraft, point) / real, realFeet, realInches, line: { a: calDraft, b: point } };
        return p;
      });
    }
    setCalDraft(null);
  };

  const handleFencePoint = (point) => {
    if (!draftPoint) {
      setDraftPoint(point);
      return;
    }
    updateProject((p) => {
      const runId = uid();
      p.runs.push({ id: runId, a: draftPoint, b: point, label: `Run ${p.runs.length + 1}`, fenceType: p.meta.fenceType, spacing: defaultPostSpacing, lengthOverride: '' });
      p.posts = regeneratePosts(p.runs, p.posts, p.calibration.pixelsPerFoot || 12);
      return p;
    });
    setDraftPoint(point);
  };

  const onCanvasMove = (event) => {
    if (!panStart || project.background.locked) return;
    const point = toWorld(event);
    updateProject((p) => {
      p.background.x = panStart.background.x + point.x - panStart.point.x;
      p.background.y = panStart.background.y + point.y - panStart.point.y;
      return p;
    });
  };

  const updateMeta = (key, value) => updateProject((p) => { p.meta[key] = value; return p; });
  const updateRun = (id, patch) => updateProject((p) => { p.runs = p.runs.map((r) => r.id === id ? { ...r, ...patch } : r); p.posts = regeneratePosts(p.runs, p.posts, p.calibration.pixelsPerFoot || 12); return p; });
  const updatePost = (id, patch) => updateProject((p) => { p.posts = p.posts.map((post) => post.id === id ? { ...post, ...patch } : post); return p; });
  const updateGate = (id, patch) => updateProject((p) => { p.gates = p.gates.map((gate) => gate.id === id ? { ...gate, ...patch } : gate); return p; });

  const uploadBackground = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return alert('Please choose a PNG, JPG, JPEG, or WebP image.');
    const reader = new FileReader();
    reader.onload = () => updateProject((p) => { p.background.dataUrl = reader.result; p.background.hidden = false; return p; });
    reader.readAsDataURL(file);
  };

  const saveProject = async () => {
    if (window.dcFencePlanner) await window.dcFencePlanner.saveProject({ ...project, jobName: project.meta.jobName });
    else download(`${project.meta.jobName || 'dc-fence-project'}.dcfence.json`, JSON.stringify(project, null, 2), 'application/json');
  };
  const openProject = async () => {
    if (window.dcFencePlanner) {
      const result = await window.dcFencePlanner.openProject();
      if (!result.canceled) updateProject(result.project);
    } else jsonInput.current.click();
  };
  const importJson = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateProject(JSON.parse(reader.result));
    reader.readAsText(file);
  };

  const exportPdf = async (kind) => {
    const canvas = await html2canvas(drawingRef.current, { backgroundColor: '#ffffff', scale: 2 });
    const pdf = new jsPDF('p', 'pt', 'letter');
    const margin = 36;
    pdf.setFontSize(18); pdf.text('DC Fencing LLC', margin, 38);
    pdf.setFontSize(12); pdf.text(kind === 'internal' ? 'Internal custom fence layout plan' : 'Customer preliminary fence layout drawing', margin, 58);
    pdf.text(`${project.meta.customerName || 'Customer'} — ${project.meta.projectAddress || 'Project address'}`, margin, 78);
    pdf.text(`Date: ${project.meta.date || ''}`, margin, 96);
    const imgWidth = 540; const imgHeight = Math.min(440, canvas.height * imgWidth / canvas.width);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, 112, imgWidth, imgHeight);
    let y = 126 + imgHeight;
    pdf.setFontSize(10);
    pdf.text(`Total linear footage: ${feetDecimal(totalFeet)} (${feetLabel(totalFeet)})   Fence type: ${project.meta.fenceType || 'N/A'}`, margin, y); y += 16;
    pdf.text('Legend: LP = Light-Ready Extended Post for customer-supplied lights.', margin, y); y += 16;
    pdf.text('Disclaimer: This is a custom fence layout plan / preliminary fence layout drawing, not an engineered drawing.', margin, y); y += 16;
    if (project.meta.customerNotes) { pdf.text(`Customer notes: ${project.meta.customerNotes}`, margin, y, { maxWidth: 540 }); y += 36; }
    if (kind === 'internal') {
      pdf.addPage(); y = 40; pdf.setFontSize(14); pdf.text('Internal material takeoff', margin, y); y += 20; pdf.setFontSize(10);
      materials.forEach((item) => { if (y > 740) { pdf.addPage(); y = 40; } pdf.text(`${item.category}: ${item.item} — ${item.quantity}`, margin, y); y += 14; });
      y += 10; pdf.setFontSize(14); pdf.text('Post list', margin, y); y += 18; pdf.setFontSize(10);
      lpPosts.forEach((post) => { if (y > 740) { pdf.addPage(); y = 40; } pdf.text(`${post.lightLabel || post.id}: ${post.type} post, ${post.size}, ${post.extension}`, margin, y); y += 14; });
      y += 10; pdf.setFontSize(14); pdf.text('Gate list', margin, y); y += 18; pdf.setFontSize(10);
      project.gates.forEach((gate) => { if (y > 740) { pdf.addPage(); y = 40; } pdf.text(`${gate.type}: ${gate.width}' W x ${gate.height}' H, ${gate.location}`, margin, y); y += 14; });
      if (project.meta.internalNotes) pdf.text(`Internal notes: ${project.meta.internalNotes}`, margin, y + 10, { maxWidth: 540 });
    }
    pdf.save(`${project.meta.jobName || 'dc-fence-plan'}-${kind}.pdf`);
  };

  const clearDrawing = () => {
    if (!confirm('Clear all fence runs, gates, and posts? Project information and screenshot stay in place.')) return;
    updateProject((p) => { p.runs = []; p.posts = []; p.gates = []; return p; });
    setSelected(null); setDraftPoint(null);
  };

  return <div className="app">
    <header className="topbar">
      <div><h1>DC Fence Planner</h1><p>Preliminary fence layout drawing tool for DC Fencing LLC</p></div>
      <div className="toolbar top-actions">
        <button onClick={saveProject}>💾 Save project file</button>
        <button onClick={openProject}>📂 Open project file</button>
        <button onClick={() => download(`${project.meta.jobName}.json`, JSON.stringify(project, null, 2), 'application/json')}>Export project JSON</button>
        <button onClick={() => jsonInput.current.click()}>Import project JSON</button>
      </div>
    </header>

    <main className="workspace">
      <aside className="panel project-panel">
        <Section title="Project setup">
          {[
            ['customerName','Customer name'], ['projectAddress','Project address'], ['phone','Phone'], ['email','Email'], ['jobName','Job name'], ['date','Date'], ['fenceType','Fence type']
          ].map(([key, label]) => <label key={key}>{label}<input type={key === 'date' ? 'date' : 'text'} value={project.meta[key]} onChange={(e) => updateMeta(key, e.target.value)} /></label>)}
          <label>Customer notes<textarea value={project.meta.customerNotes} onChange={(e) => updateMeta('customerNotes', e.target.value)} /></label>
          <label>Internal notes<textarea value={project.meta.internalNotes} onChange={(e) => updateMeta('internalNotes', e.target.value)} /></label>
        </Section>
        <HowToUse />
        <Section title="Aerial screenshot">
          <button className="wide primary-upload" onClick={() => fileInput.current.click()}>⬆️ Upload Aerial Screenshot</button>
          <label>Image opacity<input type="range" min="0" max="1" step="0.05" value={project.background.opacity} onChange={(e) => updateProject((p) => { p.background.opacity = Number(e.target.value); return p; })}/></label>
          <button className="wide" onClick={() => updateProject((p) => { p.background.locked = !p.background.locked; return p; })}>{project.background.locked ? '🔒 Unlock background' : '🔓 Lock background'}</button>
          <p className="hint"><strong>Calibrate Scale:</strong> click two known points on the screenshot, then enter the real distance in feet and inches. All run dimensions will display in feet and inches.</p>
        </Section>
      </aside>

      <section className="drawing-card">
        <div className="canvas-toolbar">
          {tools.map(([name, icon, label]) => <button key={name} className={tool === name ? 'active tool-button' : 'tool-button'} onClick={() => selectTool(name)}><span>{icon}</span>{label}</button>)}
          <button className="tool-button" onClick={() => updateProject((p) => { p.view.zoom = Math.min(2.2, (p.view.zoom || 1) * 1.15); return p; })}>🔎 Zoom In</button>
          <button className="tool-button" onClick={() => updateProject((p) => { p.view.zoom = Math.max(0.25, (p.view.zoom || 1) / 1.15); return p; })}>🔍 Zoom Out</button>
          <button className="tool-button" onClick={() => updateProject((p) => { p.view.zoom = 0.62; p.background.x = 80; p.background.y = 70; p.background.scale = 1; return p; })}>⤢ Fit to Screen</button>
          <button className="tool-button" onClick={() => updateProject((p) => { p.background.hidden = !p.background.hidden; return p; })}>{project.background.hidden ? '👁️ Show Background' : '🙈 Hide Background'}</button>
          <button className="tool-button danger-outline" onClick={clearDrawing}>🧹 Clear Drawing</button>
        </div>
        <div className="status-strip">
          <strong>Active tool:</strong> {toolLabel(tool)}
          <span><strong>Scale:</strong> {project.calibration.pixelsPerFoot ? `${project.calibration.pixelsPerFoot.toFixed(2)} px/ft` : 'Not calibrated'}</span>
          <span><strong>Total linear footage:</strong> {feetDecimal(totalFeet)} / {feetLabel(totalFeet)}</span>
        </div>
        <div className="drawing-shell">
          <div ref={drawingRef} className={`drawing ${tool}`} style={{ width: CANVAS.width * (project.view?.zoom || 1), height: CANVAS.height * (project.view?.zoom || 1) }} onMouseDown={onCanvasDown} onMouseMove={onCanvasMove} onMouseUp={() => setPanStart(null)}>
            <div className="plan-page" style={{ width: CANVAS.width, height: CANVAS.height, transform: `scale(${project.view?.zoom || 1})` }}>
              {project.background.dataUrl && !project.background.hidden && <img className="background" src={project.background.dataUrl} style={{ opacity: project.background.opacity, transform: `translate(${project.background.x}px, ${project.background.y}px) scale(${project.background.scale})` }} />}
              <PlanSvg project={project} lpPosts={lpPosts} pixelsPerFoot={pixelsPerFoot} tool={tool} selected={selected} setSelected={setSelected} updateRun={updateRun} updatePost={updatePost} updateGate={updateGate} drawingRef={drawingRef}/>
              <div className="title-block">
                <strong>DC Fencing LLC</strong><br/>
                {project.meta.customerName || 'Customer name'}<br/>
                {project.meta.projectAddress || 'Project address'}<br/>
                Date: {project.meta.date || '—'}<br/>
                Total: {feetDecimal(totalFeet)} / {feetLabel(totalFeet)}
              </div>
              <PlanLegend />
              {calDraft && <div className="cal-instruction">Click the second calibration point, then enter the known distance.</div>}
              {draftPoint && <div className="cal-instruction draw-instruction">Click next corner/end point to draw the next fence run.</div>}
            </div>
          </div>
        </div>
      </section>

      <aside className="panel editor-panel">
        <Section title="Totals">
          <div className="total-box"><span>Total linear footage</span><strong>{feetDecimal(totalFeet)}</strong><small>{feetLabel(totalFeet)}</small></div>
          <button onClick={() => exportPdf('customer')} className="wide export">📄 Export customer PDF</button>
          <button onClick={() => exportPdf('internal')} className="wide export">📋 Export internal PDF</button>
          <button onClick={() => downloadCsv(materials, project.meta.jobName)} className="wide">Export material takeoff CSV</button>
        </Section>
        <Section title="Fence runs">
          <RunList runs={project.runs} pixelsPerFoot={pixelsPerFoot} select={setSelected} remove={(id) => updateProject((p) => { p.runs = p.runs.filter((r) => r.id !== id); p.posts = regeneratePosts(p.runs, p.posts, p.calibration.pixelsPerFoot || 12); return p; })}/>
          {selectedRun && <RunEditor run={selectedRun} update={(patch) => updateRun(selectedRun.id, patch)} />}
        </Section>
        <Section title="Posts">
          <p>{project.posts.length} posts. Metal post terminology uses square tubing unless pipe is specifically selected. Post caps are not assumed by default.</p>
          {selectedPost ? <PostEditor post={selectedPost} update={(patch) => updatePost(selectedPost.id, patch)} remove={() => updateProject((p) => { p.posts = p.posts.filter((post) => post.id !== selectedPost.id); return p; })}/> : <p className="hint">Choose Select/Edit, then click any post marker on the plan.</p>}
        </Section>
        <Section title="Gates">
          {project.gates.map((gate) => <button className="list-button" key={gate.id} onClick={() => setSelected({ type: 'gate', id: gate.id })}>{gate.type} • {gate.width}'</button>)}
          {selectedGate && <GateEditor gate={selectedGate} update={(patch) => updateGate(selectedGate.id, patch)} remove={() => updateProject((p) => { p.gates = p.gates.filter((g) => g.id !== selectedGate.id); return p; })}/>}          
        </Section>
        <Section title="Materials">
          <label>Waste percent<input type="number" value={project.meta.wastePercent} onChange={(e) => updateMeta('wastePercent', Number(e.target.value))}/></label>
          <MaterialsTable rows={materials}/>
          <button className="wide" onClick={() => updateProject((p) => { p.customMaterials.push({ category: 'Custom', item: 'Custom material line item', quantity: '1' }); return p; })}>Add custom material line item</button>
        </Section>
      </aside>
    </main>
    <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadBackground}/>
    <input ref={jsonInput} hidden type="file" accept="application/json,.json,.dcfence.json" onChange={importJson}/>
  </div>;
}

function PlanSvg({ project, lpPosts, pixelsPerFoot, tool, selected, setSelected, updateRun, updatePost, updateGate, drawingRef }) {
  return <svg className="svg-layer" viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}>
    <defs>
      <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M 0 0 L 12 6 L 0 12 z" /></marker>
    </defs>
    {project.calibration.line && <g><line className="cal-line" x1={project.calibration.line.a.x} y1={project.calibration.line.a.y} x2={project.calibration.line.b.x} y2={project.calibration.line.b.y}/><text className="dimension-text" x={midpoint(project.calibration.line.a, project.calibration.line.b).x + 8} y={midpoint(project.calibration.line.a, project.calibration.line.b).y - 8}>Calibration: {project.calibration.realFeet}' {project.calibration.realInches}"</text></g>}
    {project.runs.map((run) => <FenceRun key={run.id} run={run} pixelsPerFoot={pixelsPerFoot} selected={selected?.type === 'run' && selected.id === run.id} onSelect={() => setSelected({ type: 'run', id: run.id })} updateRun={updateRun} drawingRef={drawingRef}/>) }
    {project.gates.map((gate) => <Gate key={gate.id} gate={gate} selected={selected?.type === 'gate' && selected.id === gate.id} onSelect={() => setSelected({ type: 'gate', id: gate.id })} updateGate={updateGate} drawingRef={drawingRef}/>) }
    {lpPosts.map((post) => <PostMarker key={post.id} post={post} tool={tool} selected={selected?.type === 'post' && selected.id === post.id} onSelect={() => setSelected({ type: 'post', id: post.id })} updatePost={updatePost} drawingRef={drawingRef}/>) }
  </svg>;
}

function FenceRun({ run, pixelsPerFoot, selected, onSelect, updateRun, drawingRef }) {
  const len = runLength(run, pixelsPerFoot);
  const mid = midpoint(run.a, run.b);
  const u = unitVector(run.a, run.b);
  const n = { x: -u.y, y: u.x };
  const off = 34;
  const da = { x: run.a.x + n.x * off, y: run.a.y + n.y * off };
  const db = { x: run.b.x + n.x * off, y: run.b.y + n.y * off };
  return <g className={selected ? 'selected-run' : ''} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
    <line className="run-shadow" x1={run.a.x} y1={run.a.y} x2={run.b.x} y2={run.b.y}/>
    <line className="run" x1={run.a.x} y1={run.a.y} x2={run.b.x} y2={run.b.y}/>
    <line className="extension-line" x1={run.a.x} y1={run.a.y} x2={da.x} y2={da.y}/>
    <line className="extension-line" x1={run.b.x} y1={run.b.y} x2={db.x} y2={db.y}/>
    <line className="dimension-line" x1={da.x} y1={da.y} x2={db.x} y2={db.y}/>
    <text className="dimension-text" x={mid.x + n.x * (off + 18)} y={mid.y + n.y * (off + 18)}>{feetLabel(len)}</text>
    <text className="run-label" x={mid.x} y={mid.y - 12}>{run.label}</text>
    <circle className="point" cx={run.a.x} cy={run.a.y} r="8" onMouseDown={(e) => dragRunPoint(e, updateRun, run, 'a', drawingRef)}/>
    <circle className="point" cx={run.b.x} cy={run.b.y} r="8" onMouseDown={(e) => dragRunPoint(e, updateRun, run, 'b', drawingRef)}/>
  </g>;
}

function Gate({ gate, selected, onSelect, updateGate, drawingRef }) {
  const widthPx = Math.max(54, Number(gate.width || 4) * 10);
  const label = gate.type === 'Cantilever gate'
    ? `${gate.type}: opening ${gate.openingWidth || gate.width}' tail ${gate.tailLength || '—'}' overall ${gate.overallGateLength || '—'}'`
    : `${gate.width} ft ${gate.type}`;
  return <g className={selected ? 'selected-gate' : ''} onClick={(e) => { e.stopPropagation(); onSelect(); }} onMouseDown={(e) => dragGate(e, updateGate, gate, drawingRef)}>
    <rect className="gate-body" x={gate.x - widthPx / 2} y={gate.y - 13} width={widthPx} height="26" rx="4"/>
    <line className="gate-break" x1={gate.x - widthPx / 2} y1={gate.y} x2={gate.x + widthPx / 2} y2={gate.y}/>
    {(gate.type === 'Walk gate' || gate.type === 'Double gate') && <>
      <path className="swing-arc" d={`M ${gate.x - widthPx / 2} ${gate.y} A ${widthPx} ${widthPx} 0 0 1 ${gate.x} ${gate.y - widthPx}`} />
      {gate.type === 'Double gate' && <path className="swing-arc" d={`M ${gate.x + widthPx / 2} ${gate.y} A ${widthPx} ${widthPx} 0 0 0 ${gate.x} ${gate.y - widthPx}`} />}
    </>}
    {gate.type === 'Cantilever gate' && <line className="cantilever-tail" x1={gate.x + widthPx / 2} y1={gate.y + 24} x2={gate.x + widthPx * 1.3} y2={gate.y + 24}/>}    
    <text className="gate-label" x={gate.x - widthPx / 2} y={gate.y - 24}>{label}</text>
  </g>;
}

function PostMarker({ post, tool, selected, onSelect, updatePost, drawingRef }) {
  const symbol = postSymbol(post.type);
  return <g className={selected ? 'selected-post' : ''} onClick={(e) => { e.stopPropagation(); onSelect(); if (tool === 'light' || (post.extension === 'Standard post' && e.shiftKey)) updatePost(post.id, { extension: 'Light-ready +12 inches' }); }} onMouseDown={(e) => dragPost(e, updatePost, post, drawingRef)}>
    <circle className={`post-hit ${post.lightLabel ? 'light-post' : ''}`} cx={post.x} cy={post.y} r="11"/>
    <text className="post-symbol" x={post.x} y={post.y + 5}>{symbol}</text>
    <text className="post-label" x={post.x + 13} y={post.y - 10}>{post.lightLabel || post.type.toUpperCase()}</text>
  </g>;
}

function PlanLegend() { return <div className="legend"><strong>Legend</strong><br/><span className="sym">●</span> Line post &nbsp; <span className="sym">■</span> Corner post &nbsp; <span className="sym">◆</span> Gate post<br/><span className="sym">▲</span> Terminal/end post &nbsp; <span className="sym">✚</span> Brace post &nbsp; <span className="sym">★</span> Custom post<br/><span className="gate-key"></span> Gate with width/type label and swing arc where applicable<br/><strong>LP</strong> = Light-Ready Extended Post for customer-supplied lights.<br/>Preliminary fence layout drawing — not an engineered drawing.</div>; }
function HowToUse() { return <Section title="How to use this app"><ol className="howto"><li>Enter project info</li><li>Upload aerial screenshot</li><li>Calibrate scale</li><li>Draw fence line</li><li>Add gates</li><li>Add/edit posts</li><li>Mark light-ready posts if needed</li><li>Export PDF</li></ol></Section>; }
function Section({ title, children }) { return <section className="section"><h2>{title}</h2>{children}</section>; }
function toolLabel(name) { return tools.find(([id]) => id === name)?.[2] || name; }
function runLength(run, ppf) { return run.lengthOverride ? Number(run.lengthOverride) : dist(run.a, run.b) / ppf; }
function postSymbol(type) { return ({ line: '●', corner: '■', gate: '◆', end: '▲', terminal: '▲', brace: '✚', custom: '★' })[type] || '●'; }
function snapToNearestRun(point, runs) {
  if (!runs.length) return point;
  let best = { point, distance: Infinity };
  runs.forEach((run) => {
    const vx = run.b.x - run.a.x;
    const vy = run.b.y - run.a.y;
    const lengthSq = Math.max(1, vx * vx + vy * vy);
    const t = Math.max(0, Math.min(1, ((point.x - run.a.x) * vx + (point.y - run.a.y) * vy) / lengthSq));
    const candidate = { x: run.a.x + vx * t, y: run.a.y + vy * t };
    const distance = dist(point, candidate);
    if (distance < best.distance) best = { point: candidate, distance };
  });
  return best.point;
}
function newPost(point, type = 'line', runId = '') { return { id: uid(), x: point.x, y: point.y, type, size: '2 in square tubing', runId, extension: 'Standard post', customExtension: '', notes: '' }; }
function newGate(project, point = { x: 260, y: 220 }) { return { id: uid(), type: 'Walk gate', width: 4, height: 6, x: point.x, y: point.y, runId: project.runs[0]?.id || '', location: 'Field verify', hingeSide: 'Left', swingDirection: 'In-swing', latchSide: 'Right', gatePostSize: '3 in square tubing', frameMaterial: 'Square tubing', bracingNotes: '', hardwareNotes: '', internalFabricationNotes: '', customerFacingNotes: '', openingWidth: '', tailLength: '', overallGateLength: '', rollerPostLocations: '', receiverPost: '', catchPost: '', cantileverBracingNotes: '' }; }
function regeneratePosts(runs, existing, ppf) {
  const previousAuto = new Map(existing.filter((p) => p.auto).map((p) => [p.id, p]));
  const manual = existing.filter((p) => !p.auto);
  const auto = [];
  runs.forEach((run) => {
    const length = runLength(run, ppf);
    const spacing = Number(run.spacing || defaultPostSpacing);
    const count = Math.max(2, Math.ceil(length / spacing) + 1);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const id = `auto-${run.id}-${i}`;
      const type = i === 0 || i === count - 1 ? 'terminal' : 'line';
      auto.push({ ...newPost({ x: run.a.x + (run.b.x - run.a.x) * t, y: run.a.y + (run.b.y - run.a.y) * t }, type, run.id), ...(previousAuto.get(id) || {}), id, auto: true, x: run.a.x + (run.b.x - run.a.x) * t, y: run.a.y + (run.b.y - run.a.y) * t });
    }
  });
  return [...auto, ...manual];
}
function labelLightPosts(posts) { let n = 0; return posts.map((post) => post.extension && post.extension !== 'Standard post' ? { ...post, lightLabel: `LP-${++n}` } : post); }
function buildMaterials(project, totalFeet, lpPosts) {
  const waste = 1 + Number(project.meta.wastePercent || 0) / 100;
  const rows = [
    { category: 'Fence', item: 'Total linear feet', quantity: feetDecimal(totalFeet) },
    { category: 'Fence', item: `Linear feet - ${project.meta.fenceType || 'Fence type'}`, quantity: feetDecimal(totalFeet) },
    { category: 'Rails/purlins', item: 'Rails/purlins allowance', quantity: feetDecimal(totalFeet * 2 * waste) },
    { category: 'Panels/sheets', item: 'Panels/sheets if applicable', quantity: `${Math.ceil(totalFeet / 8 * waste)} sections` },
    { category: 'Concrete', item: 'Post concrete', quantity: `${project.posts.length} post holes` },
    { category: 'Hardware', item: 'Hinges', quantity: `${project.gates.length * 2}` },
    { category: 'Hardware', item: 'Latches', quantity: `${project.gates.length}` },
    { category: 'Hardware', item: 'Screws/fasteners', quantity: `${project.meta.wastePercent || 0}% waste included` },
  ];
  countBy(project.posts, 'type').forEach(([k,v]) => rows.push({ category: 'Posts by type', item: k, quantity: v }));
  countBy(project.posts, 'size').forEach(([k,v]) => rows.push({ category: 'Posts by size', item: k, quantity: v }));
  countBy(lpPosts.filter((p) => p.lightLabel), 'extension').forEach(([k,v]) => rows.push({ category: 'Light-ready posts', item: k, quantity: v }));
  project.gates.forEach((g) => rows.push({ category: 'Gates', item: `${g.type} ${g.width}' wide`, quantity: 1 }));
  return rows.concat(project.customMaterials || []);
}
function countBy(items, key) { const map = new Map(); items.forEach((item) => map.set(item[key] || 'Unspecified', (map.get(item[key] || 'Unspecified') || 0) + 1)); return [...map.entries()]; }
function RunList({ runs, pixelsPerFoot, select, remove }) { return <div>{runs.map((run) => <div className="list-row" key={run.id}><button className="list-button" onClick={() => select({ type: 'run', id: run.id })}>{run.label} • {feetLabel(runLength(run, pixelsPerFoot))}</button><button className="icon" onClick={() => remove(run.id)}>🗑️</button></div>)}</div>; }
function RunEditor({ run, update }) { return <div className="editor"><label>Run label<input placeholder="Back Run, Left Side, Front Return..." value={run.label} onChange={(e) => update({ label: e.target.value })}/></label><label>Fence type<input value={run.fenceType} onChange={(e) => update({ fenceType: e.target.value })}/></label><label>Manual length override (feet)<input type="number" value={run.lengthOverride} onChange={(e) => update({ lengthOverride: e.target.value })}/></label><label>Post spacing for this run (feet)<input type="number" value={run.spacing} onChange={(e) => update({ spacing: Number(e.target.value) })}/></label></div>; }
function PostEditor({ post, update, remove }) { return <div className="editor"><label>Post type<select value={post.type} onChange={(e) => update({ type: e.target.value })}>{postTypes.map((t) => <option key={t}>{t}</option>)}</select></label><label>Post size/material<input value={post.size} onChange={(e) => update({ size: e.target.value })}/></label><label>Light-Ready Posts<select value={post.extension} onChange={(e) => update({ extension: e.target.value })}>{extensions.map((t) => <option key={t}>{t}</option>)}</select></label>{post.extension === 'Custom extension height' && <label>Custom extension height<input value={post.customExtension} onChange={(e) => update({ customExtension: e.target.value })}/></label>}<label>Notes<textarea value={post.notes} onChange={(e) => update({ notes: e.target.value })}/></label><button className="danger" onClick={remove}>Delete post</button></div>; }
function GateEditor({ gate, update, remove }) { const fields = [['width','Width'], ['height','Height'], ['location','Location on fence run'], ['hingeSide','Hinge side'], ['swingDirection','Swing direction'], ['latchSide','Latch side'], ['gatePostSize','Gate post size'], ['frameMaterial','Frame material'], ['bracingNotes','Bracing notes'], ['hardwareNotes','Hardware notes'], ['internalFabricationNotes','Internal fabrication notes'], ['customerFacingNotes','Customer-facing notes']]; const cant = [['openingWidth','Opening width'], ['tailLength','Tail length'], ['overallGateLength','Overall gate length'], ['rollerPostLocations','Roller/post locations'], ['receiverPost','Receiver post'], ['catchPost','Catch post'], ['cantileverBracingNotes','Custom bracing notes']]; return <div className="editor"><label>Gate type<select value={gate.type} onChange={(e) => update({ type: e.target.value })}>{gateTypes.map((t) => <option key={t}>{t}</option>)}</select></label>{fields.map(([key,label]) => <label key={key}>{label}<input value={gate[key]} onChange={(e) => update({ [key]: e.target.value })}/></label>)}{gate.type === 'Cantilever gate' && <><h3>Cantilever gate options</h3>{cant.map(([key,label]) => <label key={key}>{label}<input value={gate[key]} onChange={(e) => update({ [key]: e.target.value })}/></label>)}</>}<button className="danger" onClick={remove}>Delete gate</button></div>; }
function MaterialsTable({ rows }) { return <table><tbody>{rows.map((r, i) => <tr key={i}><td>{r.category}</td><td>{r.item}</td><td>{r.quantity}</td></tr>)}</tbody></table>; }
function pointerFromEvent(ev, ref) { const rect = ref.current.getBoundingClientRect(); const zoom = rect.width / CANVAS.width; return { x: (ev.clientX - rect.left) / zoom, y: (ev.clientY - rect.top) / zoom }; }
function dragRunPoint(e, updateRun, run, pointKey, ref) { e.stopPropagation(); const move = (ev) => updateRun(run.id, { [pointKey]: pointerFromEvent(ev, ref) }); window.addEventListener('mousemove', move); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true }); }
function dragPost(e, updatePost, post, ref) { e.stopPropagation(); const move = (ev) => updatePost(post.id, { ...pointerFromEvent(ev, ref), auto: false }); window.addEventListener('mousemove', move); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true }); }
function dragGate(e, updateGate, gate, ref) { e.stopPropagation(); const move = (ev) => updateGate(gate.id, pointerFromEvent(ev, ref)); window.addEventListener('mousemove', move); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true }); }
function download(filename, contents, type) { const blob = new Blob([contents], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function downloadCsv(rows, jobName) { const csv = ['Category,Item,Quantity', ...rows.map((r) => [r.category, r.item, r.quantity].map((v) => `"${String(v).replaceAll('"','""')}"`).join(','))].join('\n'); download(`${jobName || 'material-takeoff'}.csv`, csv, 'text/csv'); }

createRoot(document.getElementById('root')).render(<App />);
