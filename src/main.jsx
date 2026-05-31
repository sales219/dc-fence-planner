import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './styles.css';

const emptyProject = () => ({
  meta: {
    customerName: '', projectAddress: '', phone: '', email: '', jobName: 'New Fence Plan',
    date: new Date().toISOString().slice(0, 10), fenceType: 'Metal privacy fence', customerNotes: '', internalNotes: '', wastePercent: 5,
  },
  background: { dataUrl: '', opacity: 0.55, locked: false, x: 0, y: 0, scale: 1 },
  calibration: { pixelsPerFoot: 0, realFeet: 0, realInches: 0, line: null },
  runs: [], posts: [], gates: [], customMaterials: []
});

const uid = () => Math.random().toString(36).slice(2, 10);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const feetLabel = (feet) => `${Number(feet || 0).toFixed(1)} ft`;
const defaultPostSpacing = 8;
const postTypes = ['line', 'corner', 'end', 'gate', 'terminal', 'brace', 'custom'];
const gateTypes = ['Walk gate', 'Double gate', 'Sliding gate', 'Cantilever gate', 'Custom gate'];
const extensions = ['Standard post', 'Light-ready +12 inches', 'Light-ready +18 inches', 'Light-ready +24 inches', 'Light-ready +36 inches', 'Custom extension height'];

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
      const next = typeof producer === 'function' ? producer(structuredClone(current)) : producer;
      localStorage.setItem('dc-fence-autosave', JSON.stringify(next));
      return next;
    });
  };

  const pixelsPerFoot = project.calibration.pixelsPerFoot || 12;
  const totalFeet = useMemo(() => project.runs.reduce((sum, run) => sum + runLength(run, pixelsPerFoot), 0), [project.runs, pixelsPerFoot]);
  const lpPosts = useMemo(() => labelLightPosts(project.posts), [project.posts]);
  const materials = useMemo(() => buildMaterials(project, totalFeet, lpPosts), [project, totalFeet, lpPosts]);

  const toWorld = (event) => {
    const rect = drawingRef.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left), y: (event.clientY - rect.top) };
  };

  const onCanvasDown = (event) => {
    const point = toWorld(event);
    if (tool === 'pan') {
      setPanStart({ point, background: { ...project.background } });
      return;
    }
    if (tool === 'calibrate') {
      if (!calDraft) setCalDraft(point);
      else {
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
      }
      return;
    }
    if (tool === 'draw') {
      if (!draftPoint) setDraftPoint(point);
      else {
        updateProject((p) => {
          const runId = uid();
          p.runs.push({ id: runId, a: draftPoint, b: point, label: `Run ${p.runs.length + 1}`, fenceType: p.meta.fenceType, spacing: defaultPostSpacing, lengthOverride: '' });
          p.posts = regeneratePosts(p.runs, p.posts, p.calibration.pixelsPerFoot || 12);
          return p;
        });
        setDraftPoint(point);
      }
    }
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

  const onCanvasUp = () => setPanStart(null);

  const updateMeta = (key, value) => updateProject((p) => { p.meta[key] = value; return p; });
  const updateRun = (id, patch) => updateProject((p) => { p.runs = p.runs.map((r) => r.id === id ? { ...r, ...patch } : r); p.posts = regeneratePosts(p.runs, p.posts, p.calibration.pixelsPerFoot || 12); return p; });
  const updatePost = (id, patch) => updateProject((p) => { p.posts = p.posts.map((post) => post.id === id ? { ...post, ...patch } : post); return p; });
  const updateGate = (id, patch) => updateProject((p) => { p.gates = p.gates.map((gate) => gate.id === id ? { ...gate, ...patch } : gate); return p; });

  const selectedRun = selected?.type === 'run' && project.runs.find((r) => r.id === selected.id);
  const selectedPost = selected?.type === 'post' && project.posts.find((p) => p.id === selected.id);
  const selectedGate = selected?.type === 'gate' && project.gates.find((g) => g.id === selected.id);

  const uploadBackground = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return alert('Please choose a PNG, JPG, JPEG, or WebP image.');
    const reader = new FileReader();
    reader.onload = () => updateProject((p) => { p.background.dataUrl = reader.result; return p; });
    reader.readAsDataURL(file);
  };

  const saveProject = async () => {
    if (window.dcFencePlanner) await window.dcFencePlanner.saveProject(project);
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
    const imgWidth = 540; const imgHeight = Math.min(430, canvas.height * imgWidth / canvas.width);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, 116, imgWidth, imgHeight);
    let y = 132 + imgHeight;
    pdf.setFontSize(10);
    pdf.text(`Total linear footage: ${feetLabel(totalFeet)}   Fence type: ${project.meta.fenceType || 'N/A'}`, margin, y); y += 16;
    pdf.text('Legend: LP = Light-Ready Extended Post for customer-supplied lights.', margin, y); y += 16;
    pdf.text('Disclaimer: This is a custom fence layout plan / preliminary fence layout drawing, not engineered blueprints.', margin, y); y += 16;
    if (project.meta.customerNotes) { pdf.text(`Customer notes: ${project.meta.customerNotes}`, margin, y, { maxWidth: 540 }); y += 36; }
    if (kind === 'internal') {
      pdf.addPage(); y = 40; pdf.setFontSize(14); pdf.text('Internal material takeoff', margin, y); y += 20; pdf.setFontSize(10);
      materials.forEach((item) => { if (y > 740) { pdf.addPage(); y = 40; } pdf.text(`${item.category}: ${item.item} — ${item.quantity}`, margin, y); y += 14; });
      if (project.meta.internalNotes) pdf.text(`Internal notes: ${project.meta.internalNotes}`, margin, y + 10, { maxWidth: 540 });
    }
    pdf.save(`${project.meta.jobName || 'dc-fence-plan'}-${kind}.pdf`);
  };

  return <div className="app">
    <header className="topbar">
      <div><h1>DC Fence Planner</h1><p>Standalone custom fence layout plan tool for DC Fencing LLC</p></div>
      <div className="toolbar">
        <button onClick={saveProject}><Icon>💾</Icon> Save project file</button>
        <button onClick={openProject}><Icon>📂</Icon> Open project file</button>
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

        <Section title="Screenshot background">
          <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadBackground}/>
          <button className="wide" onClick={() => fileInput.current.click()}><Icon>⬆️</Icon> Upload PNG/JPG/WebP aerial screenshot</button>
          <label>Image opacity<input type="range" min="0" max="1" step="0.05" value={project.background.opacity} onChange={(e) => updateProject((p) => { p.background.opacity = Number(e.target.value); return p; })}/></label>
          <button className="wide" onClick={() => updateProject((p) => { p.background.locked = !p.background.locked; return p; })}>{project.background.locked ? <Icon>🔒</Icon> : <Icon>🔓</Icon>} {project.background.locked ? 'Unlock image' : 'Lock image'}</button>
        </Section>

        <Section title="Tools">
          <div className="toolgrid">
            {['draw','calibrate','pan','select'].map((name) => <button key={name} className={tool === name ? 'active' : ''} onClick={() => { setTool(name); setDraftPoint(null); }}>{name}</button>)}
          </div>
          <p className="hint">Draw: click points for fence runs. Calibrate: click two points, then enter real distance. Pan: move unlocked screenshot.</p>
          <div className="row"><button onClick={() => updateProject((p) => { p.background.scale *= 1.1; return p; })}><Icon>🔍</Icon> Zoom</button><button onClick={() => updateProject((p) => { p.background.scale /= 1.1; return p; })}><Icon>🔎</Icon> Zoom</button></div>
          <strong>Scale:</strong> {project.calibration.pixelsPerFoot ? `${project.calibration.pixelsPerFoot.toFixed(2)} px/ft` : 'Not calibrated'}<br/>
          <strong>Total:</strong> {feetLabel(totalFeet)}
        </Section>
      </aside>

      <section className="drawing-card">
        <div className="drawing-actions">
          <button onClick={() => exportPdf('customer')}><Icon>📄</Icon> Export customer PDF</button>
          <button onClick={() => exportPdf('internal')}><Icon>📄</Icon> Export internal PDF</button>
          <button onClick={() => downloadCsv(materials, project.meta.jobName)}>Export material takeoff CSV</button>
          <button onClick={() => updateProject((p) => { p.posts.push(newPost({ x: 120, y: 120 }, 'custom')); return p; })}><Icon>＋</Icon> Add post</button>
          <button onClick={() => updateProject((p) => { p.gates.push(newGate(p)); return p; })}><Icon>＋</Icon> Add gate</button>
        </div>
        <div ref={drawingRef} className={`drawing ${tool}`} onMouseDown={onCanvasDown} onMouseMove={onCanvasMove} onMouseUp={onCanvasUp}>
          {project.background.dataUrl && <img className="background" src={project.background.dataUrl} style={{ opacity: project.background.opacity, transform: `translate(${project.background.x}px, ${project.background.y}px) scale(${project.background.scale})` }} />}
          <svg className="svg-layer">
            {project.calibration.line && <line className="cal-line" x1={project.calibration.line.a.x} y1={project.calibration.line.a.y} x2={project.calibration.line.b.x} y2={project.calibration.line.b.y}/>}            
            {project.runs.map((run) => <g key={run.id} onClick={(e) => { e.stopPropagation(); setSelected({ type: 'run', id: run.id }); }}>
              <line className="run" x1={run.a.x} y1={run.a.y} x2={run.b.x} y2={run.b.y}/>
              <circle className="point" cx={run.a.x} cy={run.a.y} r="7" onMouseDown={(e) => dragRunPoint(e, updateRun, run, 'a', drawingRef)}/>
              <circle className="point" cx={run.b.x} cy={run.b.y} r="7" onMouseDown={(e) => dragRunPoint(e, updateRun, run, 'b', drawingRef)}/>
              <text className="run-label" x={(run.a.x + run.b.x)/2} y={(run.a.y + run.b.y)/2 - 8}>{run.label} • {feetLabel(runLength(run, pixelsPerFoot))}</text>
            </g>)}
            {project.gates.map((gate) => <g key={gate.id} onClick={(e) => { e.stopPropagation(); setSelected({ type: 'gate', id: gate.id }); }}>
              <rect className="gate" x={gate.x - 24} y={gate.y - 14} width="48" height="28" rx="4"/>
              <text className="gate-label" x={gate.x - 32} y={gate.y - 20}>{gate.type} {gate.width}'</text>
            </g>)}
            {lpPosts.map((post) => <g key={post.id} onClick={(e) => { e.stopPropagation(); setSelected({ type: 'post', id: post.id }); }}>
              <circle className={`post ${post.lightLabel ? 'light-post' : ''}`} cx={post.x} cy={post.y} r="5" onMouseDown={(e) => dragPost(e, updatePost, post, drawingRef)}/>
              <text className="post-label" x={post.x + 7} y={post.y - 7}>{post.lightLabel || post.type[0].toUpperCase()}</text>
            </g>)}
          </svg>
          <div className="legend"><strong>Legend</strong><br/>LP = Light-Ready Extended Post for customer-supplied lights.<br/>This is a custom fence layout plan, not engineered blueprints.</div>
        </div>
      </section>

      <aside className="panel editor-panel">
        <Section title="Fence drawing">
          <RunList runs={project.runs} pixelsPerFoot={pixelsPerFoot} select={setSelected} remove={(id) => updateProject((p) => { p.runs = p.runs.filter((r) => r.id !== id); p.posts = regeneratePosts(p.runs, p.posts, p.calibration.pixelsPerFoot || 12); return p; })}/>
          {selectedRun && <RunEditor run={selectedRun} update={(patch) => updateRun(selectedRun.id, patch)} />}
        </Section>
        <Section title="Posts">
          <p>{project.posts.length} posts. Metal post terminology uses square tubing unless pipe is specifically selected. Post caps are not assumed by default.</p>
          {selectedPost && <PostEditor post={selectedPost} update={(patch) => updatePost(selectedPost.id, patch)} remove={() => updateProject((p) => { p.posts = p.posts.filter((post) => post.id !== selectedPost.id); return p; })}/>}          
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
    <input ref={jsonInput} hidden type="file" accept="application/json,.json,.dcfence.json" onChange={importJson}/>
  </div>;
}

function Icon({ children }) { return <span className="button-icon" aria-hidden="true">{children}</span>; }
function Section({ title, children }) { return <section className="section"><h2>{title}</h2>{children}</section>; }
function runLength(run, ppf) { return run.lengthOverride ? Number(run.lengthOverride) : dist(run.a, run.b) / ppf; }
function newPost(point, type = 'line', runId = '') { return { id: uid(), x: point.x, y: point.y, type, size: '2 in square tubing', runId, extension: 'Standard post', customExtension: '', notes: '' }; }
function newGate(project) { return { id: uid(), type: 'Walk gate', width: 4, height: 6, x: 180, y: 180, runId: project.runs[0]?.id || '', location: 'Field verify', hingeSide: 'Left', swingDirection: 'In-swing', latchSide: 'Right', gatePostSize: '3 in square tubing', frameMaterial: 'Square tubing', bracingNotes: '', hardwareNotes: '', internalFabricationNotes: '', customerFacingNotes: '', openingWidth: '', tailLength: '', overallGateLength: '', rollerPostLocations: '', receiverPost: '', catchPost: '', cantileverBracingNotes: '' }; }
function regeneratePosts(runs, existing, ppf) {
  const manual = existing.filter((p) => !p.auto);
  const auto = [];
  runs.forEach((run) => {
    const length = runLength(run, ppf);
    const spacing = Number(run.spacing || defaultPostSpacing);
    const count = Math.max(2, Math.ceil(length / spacing) + 1);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      auto.push({ ...newPost({ x: run.a.x + (run.b.x - run.a.x) * t, y: run.a.y + (run.b.y - run.a.y) * t }, i === 0 || i === count - 1 ? 'terminal' : 'line', run.id), id: `auto-${run.id}-${i}`, auto: true });
    }
  });
  return [...auto, ...manual];
}
function labelLightPosts(posts) {
  let n = 0;
  return posts.map((post) => post.extension && post.extension !== 'Standard post' ? { ...post, lightLabel: `LP-${++n}` } : post);
}
function buildMaterials(project, totalFeet, lpPosts) {
  const waste = 1 + Number(project.meta.wastePercent || 0) / 100;
  const rows = [
    { category: 'Fence', item: 'Total linear feet', quantity: feetLabel(totalFeet) },
    { category: 'Fence', item: `Linear feet - ${project.meta.fenceType || 'Fence type'}`, quantity: feetLabel(totalFeet) },
    { category: 'Rails/purlins', item: 'Rails/purlins allowance', quantity: feetLabel(totalFeet * 2 * waste) },
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
function RunList({ runs, pixelsPerFoot, select, remove }) { return <div>{runs.map((run) => <div className="list-row" key={run.id}><button className="list-button" onClick={() => select({ type: 'run', id: run.id })}>{run.label} • {feetLabel(runLength(run, pixelsPerFoot))}</button><button className="icon" onClick={() => remove(run.id)}><Icon>🗑️</Icon></button></div>)}</div>; }
function RunEditor({ run, update }) { return <div className="editor"><label>Run label<input value={run.label} onChange={(e) => update({ label: e.target.value })}/></label><label>Fence type<input value={run.fenceType} onChange={(e) => update({ fenceType: e.target.value })}/></label><label>Manual length override (feet)<input type="number" value={run.lengthOverride} onChange={(e) => update({ lengthOverride: e.target.value })}/></label><label>Post spacing for this run (feet)<input type="number" value={run.spacing} onChange={(e) => update({ spacing: Number(e.target.value) })}/></label></div>; }
function PostEditor({ post, update, remove }) { return <div className="editor"><label>Post type<select value={post.type} onChange={(e) => update({ type: e.target.value })}>{postTypes.map((t) => <option key={t}>{t}</option>)}</select></label><label>Post size/material<input value={post.size} onChange={(e) => update({ size: e.target.value })}/></label><label>Light-Ready Posts<select value={post.extension} onChange={(e) => update({ extension: e.target.value })}>{extensions.map((t) => <option key={t}>{t}</option>)}</select></label>{post.extension === 'Custom extension height' && <label>Custom extension height<input value={post.customExtension} onChange={(e) => update({ customExtension: e.target.value })}/></label>}<label>Notes<textarea value={post.notes} onChange={(e) => update({ notes: e.target.value })}/></label><button className="danger" onClick={remove}>Delete post</button></div>; }
function GateEditor({ gate, update, remove }) { const fields = [['width','Width'], ['height','Height'], ['location','Location on fence run'], ['hingeSide','Hinge side'], ['swingDirection','Swing direction'], ['latchSide','Latch side'], ['gatePostSize','Gate post size'], ['frameMaterial','Frame material'], ['bracingNotes','Bracing notes'], ['hardwareNotes','Hardware notes'], ['internalFabricationNotes','Internal fabrication notes'], ['customerFacingNotes','Customer-facing notes']]; const cant = [['openingWidth','Opening width'], ['tailLength','Tail length'], ['overallGateLength','Overall gate length'], ['rollerPostLocations','Roller/post locations'], ['receiverPost','Receiver post'], ['catchPost','Catch post'], ['cantileverBracingNotes','Custom bracing notes']]; return <div className="editor"><label>Gate type<select value={gate.type} onChange={(e) => update({ type: e.target.value })}>{gateTypes.map((t) => <option key={t}>{t}</option>)}</select></label>{fields.map(([key,label]) => <label key={key}>{label}<input value={gate[key]} onChange={(e) => update({ [key]: e.target.value })}/></label>)}{gate.type === 'Cantilever gate' && <><h3>Cantilever gate options</h3>{cant.map(([key,label]) => <label key={key}>{label}<input value={gate[key]} onChange={(e) => update({ [key]: e.target.value })}/></label>)}</>}<button className="danger" onClick={remove}>Delete gate</button></div>; }
function MaterialsTable({ rows }) { return <table><tbody>{rows.map((r, i) => <tr key={i}><td>{r.category}</td><td>{r.item}</td><td>{r.quantity}</td></tr>)}</tbody></table>; }
function dragRunPoint(e, updateRun, run, pointKey, ref) { e.stopPropagation(); const move = (ev) => { const rect = ref.current.getBoundingClientRect(); updateRun(run.id, { [pointKey]: { x: ev.clientX - rect.left, y: ev.clientY - rect.top } }); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true }); }
function dragPost(e, updatePost, post, ref) { e.stopPropagation(); const move = (ev) => { const rect = ref.current.getBoundingClientRect(); updatePost(post.id, { x: ev.clientX - rect.left, y: ev.clientY - rect.top, auto: false }); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true }); }
function download(filename, contents, type) { const blob = new Blob([contents], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function downloadCsv(rows, jobName) { const csv = ['Category,Item,Quantity', ...rows.map((r) => [r.category, r.item, r.quantity].map((v) => `"${String(v).replaceAll('"','""')}"`).join(','))].join('\n'); download(`${jobName || 'material-takeoff'}.csv`, csv, 'text/csv'); }

createRoot(document.getElementById('root')).render(<App />);
