// Shared content and intended geometry for DOCX and approximate browser preview.
// Pure ESM: no DOM, canvas, docx, I/O, or application-state mutations.
import { resolveFindingPrefix, REPORT_SECTIONS, FINDING_SECTIONS, REPORT_SECTIONS_V4, REPORT_SECTIONS_V5, FINDING_SECTIONS_V4, SCORING_MODES, LIMITS, limitsForVersion, savedSize, screenshotRefs, detailsTextLength, validateReferences,
  CUSTOM_LIMITS, CUSTOM_SECTION_ID, customKey, customTitleErrors, cweErrors, vulnerabilityTypeErrors } from '../app/project.js';
import { parseCvss, cvssLabel, reportCvssVersion, ratingCounts, formatFindingStatus, formatEngagementStatus, findingStatusCounts } from '../scoring/index.js';
import { reportDesign, ratingBadge, cvssBadge } from './design.js';
export { resolveFindingPrefix } from '../app/project.js';

const PAPERS = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } };
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
function txt(value = '') {
  if (typeof value !== 'string' || BAD_XML.test(value)) throw new Error('Invalid XML text in report plan.');
  return value;
}
const fit = (w, h, maxW, maxH) => {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
};

export function getDisplayFindingId(project, index) {
  if (!Number.isInteger(index) || index < 0 || index >= project.findings.length) throw new Error('Invalid finding position.');
  return resolveFindingPrefix(project.project) + '-' + (index + 1);
}

export function resolveEngagementValue(row, meta) {
  if (row.source === 'custom') return txt(row.value);
  if (row.source === 'engagementStatus') return txt(formatEngagementStatus(meta.engagementStatus,{notSet:meta.labels?.statusNotSet??'Not set'}));
  if (row.source === 'testingPeriod') return [meta.startDate, meta.endDate].filter(Boolean).map(txt).join(' \u2013 ');
  return txt(meta[row.source] ?? '');
}

function scoring(finding, mode, labels, version, authoredCvss = labels.cvss) {
  const result = [];
  if (mode !== 'cvss') result.push({ key: 'rating', label: mode.startsWith('risk') ? labels.risk : labels.severity, value: finding.rating ?? labels.unscored, badge:ratingBadge(finding.rating) });
  if (mode.includes('cvss')) {
    // The report uses one CVSS version, named in the label. A score in another version (to be
    // rescored before export) says which version it is; text copied out always does (versioned).
    const parsed = finding.cvss === null ? null : parseCvss(finding.cvss);
    const versioned = parsed ? `${parsed.score.toFixed(1)} (${parsed.version})` : labels.unscored;
    result.push({ key: 'cvss', label: parsed && parsed.version !== version ? cvssLabel(authoredCvss, parsed.version) : labels.cvss, ownLabel: parsed ? cvssLabel(authoredCvss, parsed.version) : labels.cvss, value: parsed && parsed.version === version ? parsed.score.toFixed(1) : versioned, versioned, mismatch: !!parsed && parsed.version !== version, score: parsed?.score ?? null, version: parsed?.version ?? null, vector: parsed?.vector ?? null, badge:cvssBadge(parsed?.score ?? null) });
  }
  return result;
}

function config(list, keys) {
  if (!Array.isArray(list) || list.length !== keys.length || new Set(list.map(s => s.key)).size !== keys.length || list.some(s => !keys.includes(s.key))) {
    throw new Error('Invalid section configuration.');
  }
  for (const s of list) { txt(s.label); if (typeof s.enabled !== 'boolean') throw new Error('Invalid section switch.'); }
  return list;
}

// Conservative Calibri-sized estimate for one-line summary IDs. It is geometry,
// not a font-shaping oracle; native/browser consumer checks remain necessary.
function idEm(value){
  return Array.from(value).reduce((n,c)=>n+(/\p{Mark}/u.test(c)?0:/[MW]/.test(c)?1:/[A-Z]/.test(c)?.75:/[0-9]/.test(c)?.6:/[-_.:/]/.test(c)?.45:/[il]/.test(c)?.35:/[mw]/.test(c)?.9:/[a-z]/.test(c)?.65:c===' '?.35:c.codePointAt(0)>65535?2.2:1.1),0);
}
function summaryGeometry(columns,rows,geometry,design){
  const width=geometry.contentWidth*15,padding=(design.cellPadding.left+design.cellPadding.right)/20+4;
  const longest=Math.max(1,...rows.map(r=>idEm(r.displayId)));
  const desired=Math.max(44,longest*design.tablePt+padding),idPt=Math.min(desired,width/20*.56);
  const extras=columns.filter(c=>c.key!=='id'&&c.key!=='title');
  const preferred=extras.map(c=>c.key==='classification'?110:80),sum=preferred.reduce((a,b)=>a+b,0);
  const available=Math.max(0,width/20-idPt-width/20*.18),scale=sum?Math.min(1,available/sum):1;
  const widths=new Map([['id',Math.round(idPt*20)],...extras.map((c,i)=>[c.key,Math.round(preferred[i]*scale*20)])]);
  widths.set('title',Math.round(width)-[...widths.values()].reduce((a,b)=>a+b,0));
  return {columns:columns.map(c=>({...c,widthTwips:widths.get(c.key),widthPct:widths.get(c.key)/Math.round(width)*100})),
    idFontPt:Math.min(design.tablePt,Math.floor(Math.max(.5,(idPt-padding)/longest)*2)/2)};
}
function horizontalCounts(summary){
  const distributions=[...summary.ratingCounts.distributions,...(summary.statusCounts?[{...summary.statusCounts,key:'status',workflow:true}]:[])];
  return distributions.map(d=>({key:d.key,label:d.label,rowLabel:'Findings',total:d.total,
    columns:[...d.rows.filter(r=>!((r.key==='unscored'||r.key===null)&&r.count===0)).map(r=>({...r,badge:d.workflow?null:r.key==='None'?cvssBadge(0):ratingBadge(r.key)})),
      {key:'total',label:'Total',count:d.total,badge:null}]}));
}

// Conservative intended line estimate, not a Word pagination oracle. Count a full
// em per character (tabs expanded to 8); skip grouping anything that may be long.
function shortSection(value, format, width, design, literal=false) {
  const lines=value.split(/\r\n|\r|\n/), visible=format==='code'||literal?lines:lines.filter(line=>line.trim());
  const em=(format==='code'?design.codePt:design.bodyPt)*96/72;
  const charsPerLine=Math.max(1,Math.floor((width-24)/em));
  return visible.reduce((n,line)=>n+Math.max(1,Math.ceil(Array.from(line.replace(/\t/g,'        ')).length/charsPerLine)),0)<=design.shortSectionMaxLines;
}

function partsFor(image, figure, geometry, labels) {
  if (!['auto', 'fit', 'split'].includes(image.tallMode)) throw new Error('Invalid image layout.');
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
      image.width > LIMITS.imageSide || image.height > LIMITS.imageSide || image.width * image.height > LIMITS.imagePixels) throw new Error('Invalid image dimensions.');
  const maxW = geometry.contentWidth, scale = Math.min(1, maxW / image.width);
  // Conservative caption reserve (wide Unicode glyphs included), shared with preview.
  // This is intended geometry, not a guarantee of Word's text/font pagination.
  const caption = txt(image.caption);
  const longest = labels.figure + ' 999 ' + caption + ' (' + labels.part + ' 99 ' + labels.partOf + ' 99)';
  const charsPerLine = Math.max(1, Math.floor(maxW / 14));
  const reserve = Math.max(85, Math.ceil(Array.from(longest).length / charsPerLine) * 16 + 32);
  const maxH = Math.max(64, geometry.contentHeight - reserve);
  const split = image.tallMode !== 'fit' && image.height * scale > maxH;
  const step = split ? Math.max(1, Math.floor(maxH / scale)) : image.height;
  const count = Math.ceil(image.height / step), parts = [];
  // Balance source rows across the same number of parts: never leave a tiny tail
  // on an otherwise empty page. Floor boundaries cover each row exactly once.
  for (let partIndex=0;partIndex<count;partIndex++) {
    const y=Math.floor(partIndex*image.height/count);
    const sourceHeight=Math.floor((partIndex+1)*image.height/count)-y,index=partIndex+1;
    parts.push({ index, count, y, sourceWidth: image.width, sourceHeight,
      ...fit(image.width, sourceHeight, maxW, maxH),
      captionSuffix: count > 1 ? ` (${labels.part} ${index} ${labels.partOf} ${count})` : '',
      sequence: index === 1 ? 'increment' : 'repeat' });
  }
  return { imageId: image.id, caption, figure, parts };
}

export function createReportPlan(project, { paperSize = project?.project?.paperSize } = {}) {
  if (project?.format !== 'fieldnote-project' || ![2,3,4,5,6,7,8].includes(project.schemaVersion) || !PAPERS[paperSize]) throw new Error('A validated schema v2-v8 project and A4/Letter paper are required.');
  // The bounds of the project's own format version, with the reason when one is passed.
  const L = limitsForVersion(project.schemaVersion);
  if (!Array.isArray(project.findings) || !Array.isArray(project.images)) throw new Error('Project exceeds supported bounds.');
  if (project.findings.length > L.findings) throw new Error(`the report has ${project.findings.length} findings; format ${project.schemaVersion} holds at most ${L.findings}.`);
  if (project.images.length > L.images) throw new Error(`the report has ${project.images.length} images; format ${project.schemaVersion} holds at most ${L.images}.`);
  if (savedSize(project) > L.fileBytes) throw new Error(`the project file would be larger than format ${project.schemaVersion} allows.`);
  const p = project.project, mode = p.scoring.mode, v4=project.schemaVersion>=4;
  if (!SCORING_MODES.includes(mode)) throw new Error('Unsupported scoring mode.');
  const labels = Object.fromEntries(Object.entries(p.labels).map(([key, value]) => [key, txt(value)]));
  const cvssVersionUsed = reportCvssVersion(project), authoredCvss = labels.cvss;
  labels.cvss = cvssLabel(labels.cvss, cvssVersionUsed);
  // v6: the user's own sections. Each has exactly one report row,
  // labelled with its title; ids are short and Word-safe, so anchors fit a bookmark name.
  const v6=project.schemaVersion>=6, custom=new Map();
  if(v6){
    if(!Array.isArray(p.customSections)||p.customSections.length>CUSTOM_LIMITS.sections)throw new Error('Invalid custom sections.');
    for(const c of p.customSections){
      if(!CUSTOM_SECTION_ID.test(c?.id??'')||custom.has(c.id)||customTitleErrors(c.title).length||!['plain','code'].includes(c.format)||typeof c.text!=='string'||c.text.length>LIMITS.text)throw new Error('Invalid custom section.');
      txt(c.text);custom.set(customKey(c.id),c);
    }
    if(!p.classificationDisplay||Object.keys(p.classificationDisplay).length!==2||['keyFacts','summaryColumn'].some(k=>typeof p.classificationDisplay[k]!=='boolean'))throw new Error('Invalid classification display configuration.');
  }
  const reportConfigs = config(p.sections.report, [...(project.schemaVersion>=5?REPORT_SECTIONS_V5:v4?REPORT_SECTIONS_V4:REPORT_SECTIONS),...custom.keys()]), findingConfigs = config(p.sections.finding, v4?FINDING_SECTIONS_V4:FINDING_SECTIONS);
  if(v6&&reportConfigs.some(s=>custom.has(s.key)&&s.label!==custom.get(s.key).title))throw new Error('Invalid custom section configuration.');
  if(v4&&(!p.findingStatusDisplay||Object.keys(p.findingStatusDisplay).length!==3||['keyFacts','summaryColumn','counts'].some(k=>typeof p.findingStatusDisplay[k]!=='boolean')))throw new Error('Invalid status display configuration.');
  const imageMap = new Map();
  for (const image of project.images) {
    if (imageMap.has(image.id)) throw new Error('Duplicate image id.');
    imageMap.set(image.id, { ...image });
  }
  const refs = project.findings.flatMap(f => screenshotRefs(f).map(r => r.imageId));
  if (refs.length > L.evidence) throw new Error(`the report has ${refs.length} screenshots; format ${project.schemaVersion} holds at most ${L.evidence}.`);
  if (new Set(refs).size !== refs.length || refs.some(id => !imageMap.has(id))) throw new Error('Invalid evidence references.');
  const ids = new Set();
  for (const f of project.findings) {
    if (!/^F-(?!000)[0-9]{3}$/.test(f.id) || ids.has(f.id)) throw new Error('Invalid or duplicate finding id.');
    ids.add(f.id);
    if(v6&&(cweErrors(f.cwe).length||vulnerabilityTypeErrors(f.vulnerabilityType).length))throw new Error('Invalid finding classification.');
    if(v4){
      formatFindingStatus(f.status,{notSet:labels.statusNotSet});
      validateReferences(f.references===undefined?[]:f.references,'references',(path,message)=>{throw new Error(path+': '+message);});
      for(const r of f.references??[]){txt(r.title);txt(r.url);}
    }
    if (project.schemaVersion >= 3) {
      const blocks = f.details ?? [];
      if (!Array.isArray(blocks) || blocks.length > LIMITS.detailBlocks || detailsTextLength(f) > LIMITS.text) throw new Error('Invalid details block bounds.');
      const blockIds = new Set();
      for (const b of blocks) {
        if (!b || typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id) || blockIds.has(b.id)) throw new Error('Invalid or duplicate block id.');
        blockIds.add(b.id);
        if (b.type === 'text') {
          txt(b.text);
          if (!['plain','code'].includes(b.format)) throw new Error('Invalid block format.');
        } else if (b.type !== 'image') throw new Error('Invalid details block type.');
      }
    }
  }
  const roles = ['testerLogo', 'clientLogo'];
  const logosAt = (placement, maxW, maxH) => roles.flatMap(role => {
    const r = p.branding[role];
    if (r.imageId === null) return [];
    const image = imageMap.get(r.imageId);
    if (!image || refs.includes(r.imageId)) throw new Error('Invalid logo reference.');
    if (!r[placement]) return [];
    return [{ role, imageId: r.imageId, ...fit(image.width, image.height, maxW, maxH) }];
  });
  const headerLogos = logosAt('header', 140, 32), footerLogos = logosAt('footer', 100, 24);
  const paper = PAPERS[paperSize];
  const footerPrefix = [p.organisation,p.classification].filter(Boolean).map(txt).join(' | ');
  const contentWidth = (paper.width - 2268) / 15;
  const footerLines = Math.max(1,Math.ceil(Array.from(footerPrefix).length / Math.floor(contentWidth/11))) + 1;
  const margin = { top: headerLogos.length ? 100 : 1134 / 15, right: 1134 / 15,
    bottom:Math.max(footerLogos.length ? 100 : 1134/15,500/15+footerLines*14+12+(footerLogos.length?24:0)),left:1134/15 };
  const geometry = { pageWidth: paper.width / 15, pageHeight: paper.height / 15, margin,
    contentWidth: (paper.width - 2268) / 15, contentHeight: paper.height / 15 - margin.top - margin.bottom,
    headerDistance: 500 / 15, footerDistance: 500 / 15 };
  const metadata = Object.fromEntries(['title', 'subtitle', 'client', 'testerName', 'organisation', 'reportVersion', 'reportDate', 'classification','engagementId','startDate','endDate'].map(key => [key, txt(p[key] ?? '')]));
  if(v4)metadata.engagementStatus={key:p.engagementStatus,label:txt(formatEngagementStatus(p.engagementStatus,{notSet:labels.statusNotSet}))};
  metadata.accentColor = /^#[0-9a-fA-F]{6}$/.test(p.accentColor ?? '') ? p.accentColor : '#253F78';
  const design=reportDesign(metadata.accentColor.slice(1));
  const summaryEnabled = reportConfigs.find(s => s.key === 'findingsSummary').enabled;
  let figure = 0;
  const findings = project.findings.map((finding, index) => {
    const findingRefs = screenshotRefs(finding);
    const sections = findingConfigs.filter(s => s.enabled).flatMap(s => {
      if(s.key==='references'){
        const rows=(finding.references??[]).map(r=>({title:txt(r.title),url:txt(r.url)}));
        return rows.length?[{key:s.key,label:s.label,kind:'references',rows}]:[];
      }
      if (s.key === 'details' && project.schemaVersion >= 3) {
        const inlineRefs = new Map(findingRefs.filter(r => r.where === 'details').map(r => [r.blockId,r.imageId]));
        const blocks = (finding.details ?? []).flatMap(b => b.type === 'text'
          ? [{kind:'text',blockId:b.id,text:txt(b.text),format:b.format}]
          : [{kind:'evidence',blockId:b.id,image:partsFor(imageMap.get(inlineRefs.get(b.id)),++figure,geometry,labels)}]);
        // Once a section has content, retain even blank code blocks in its sequence.
        return blocks.some(b => b.kind === 'evidence' || b.text.trim())
          ? [{key:s.key,label:s.label,kind:'blocks',blocks}] : [];
      }
      if (s.key === 'evidence') {
        const images = findingRefs.filter(r => r.where === 'evidence').map(r => partsFor(imageMap.get(r.imageId), ++figure, geometry, labels));
        return images.length ? [{ key: s.key, label: s.label, kind: 'evidence', images }] : [];
      }
      const value = s.key === 'assets' ? (finding.affectedAssets ?? []).map(txt).join('\n') : txt(finding[s.key] ?? '');
      const format=s.key === 'assets' ? 'plain' : finding.formats[s.key];
      return value.trim() ? [{ key: s.key, label: s.label, kind: 'text', text: value,
        format, literal:s.key === 'assets',keepTogether:shortSection(value,format,geometry.contentWidth,design,s.key==='assets') }] : [];
    });
    const displayId=getDisplayFindingId(project,index), scores=scoring(finding,mode,labels,cvssVersionUsed,authoredCvss);
    const keyFacts=[{key:'id',label:labels.idColumn,value:displayId,badge:null,detail:null},...scores.map(s=>({...s,detail:s.vector??null}))];
    const status=v4?{key:finding.status,label:txt(formatFindingStatus(finding.status,{notSet:labels.statusNotSet}))}:null;
    if(v4&&p.findingStatusDisplay.keyFacts)keyFacts.push({key:'status',label:labels.status,value:status.label,badge:null,detail:null});
    // v6 classification: the tester's own entries, shown as typed; empty values print nothing.
    const classification=v6?{cwe:txt(finding.cwe),vulnerabilityType:txt(finding.vulnerabilityType)}:null;
    if(v6&&p.classificationDisplay.keyFacts){
      if(classification.vulnerabilityType)keyFacts.push({key:'vulnerabilityType',label:labels.vulnerabilityType,value:classification.vulnerabilityType,badge:null,detail:null});
      if(classification.cwe)keyFacts.push({key:'cwe',label:labels.cwe,value:classification.cwe,badge:null,detail:null});
    }
    return { id: finding.id, displayId, title: txt(finding.title),
      anchor: 'finding_' + finding.id.replace('-', '_'), backToSummary: p.backToSummaryLinks && summaryEnabled,
      scoring:scores,keyFacts, sections,...(v4?{status}:{}),...(v6?{classification}:{}) };
  });
  const scoreColumns = findings[0]?.scoring ?? scoring({ rating: null, cvss: null }, mode, labels, cvssVersionUsed);
  const classifyColumn=v6&&summaryEnabled&&p.classificationDisplay.summaryColumn;
  // One combined column: "Type (CWE-n)", either one alone, or a dash when both are empty.
  const classified=f=>{const {cwe,vulnerabilityType:t}=f.classification;return t&&cwe?`${t} (${cwe})`:t||cwe||'\u2013';};
  const summary = { enabled: summaryEnabled, anchor: 'report_summary', ratingCounts: ratingCounts(project),
    columns: [{ key: 'id', label: labels.idColumn }, { key: 'title', label: labels.titleColumn }, ...scoreColumns.map(s => ({ key: s.key, label: s.key === 'cvss' ? labels.cvss : s.label })),...(v4&&summaryEnabled&&p.findingStatusDisplay.summaryColumn?[{key:'status',label:labels.status}]:[]),...(classifyColumn?[{key:'classification',label:labels.classification}]:[])],
    rows: findings.map(f => ({ id: f.id, displayId: f.displayId, title: f.title, anchor: f.anchor,
      badges:Object.fromEntries(f.scoring.map(s=>[s.key,s.badge])),
      values: { id: f.displayId, title: f.title, ...Object.fromEntries(f.scoring.map(s => [s.key, s.value])),...(v4&&summaryEnabled&&p.findingStatusDisplay.summaryColumn?{status:f.status.label}:{}),...(classifyColumn?{classification:classified(f)}:{}) } })),
    ...(v4?{statusCounts:summaryEnabled&&p.findingStatusDisplay.counts?findingStatusCounts(project):null,
      statusNote:summaryEnabled&&(p.findingStatusDisplay.summaryColumn||p.findingStatusDisplay.counts)?'Counts include every finding in this report, whatever its status.':null}:{}) };
  // Shown in the preview while CVSS counts are withheld (exports are refused in that state).
  const withheld=summary.ratingCounts.cvssWithheld;
  summary.cvssCountsNote=summaryEnabled&&withheld?`${labels.cvss} counts are not shown: ${withheld===1?'1 finding is':`${withheld} findings are`} scored in another CVSS version. Rescore or clear ${withheld===1?'its score':'their scores'} to show them.`:null;
  Object.assign(summary,summaryGeometry(summary.columns,summary.rows,geometry,design));
  summary.countTables=summaryEnabled?horizontalCounts(summary):[];
  let reportSections = reportConfigs.filter(s => s.enabled).flatMap(s => {
    if(s.key==='contents')return [{...s,kind:'contents'}];
    if (s.key === 'findingsSummary') return [{ ...s, kind: 'summary' }];
    if (s.key === 'engagement') {
      const rows = p.engagement.rows.filter(r => r.enabled).map(r => ({ label: txt(r.label), value: resolveEngagementValue(r, p), format: r.source === 'custom' ? r.format : 'plain', literal:r.source !== 'custom' })).filter(r => r.value.trim());
      return rows.length ? [{ key: s.key, label: s.label, kind: 'engagement', rows }] : [];
    }
    // A custom section (v6) is authored text in its own format; empty prints nothing.
    if (custom.has(s.key)) {
      const c = custom.get(s.key);
      return c.text.trim() ? [{ key: s.key, label: s.label, kind: 'text', text: c.text, format: c.format, anchor: 'report_custom_' + c.id }] : [];
    }
    // ratingMethod (v5) is authored text like the scope; an empty one prints nothing.
    const value = txt((s.key === 'ratingMethod' ? p.ratingMethod?.text : p[s.key]) ?? '');
    return value.trim() ? [{ key: s.key, label: s.label, kind: 'text', text: value, format: 'plain' }] : [];
  });
  let contents;
  const findingsAnchor='report_findings';
  if(v4){
    const anchors={executiveSummary:'report_executive_summary',engagement:'report_engagement',scope:'report_scope',ratingMethod:'report_rating_method',findingsSummary:summary.anchor};
    reportSections=reportSections.map(s=>s.kind==='contents'?s:{...s,anchor:s.anchor??anchors[s.key]});
    const targets=[...reportSections.filter(s=>s.kind!=='contents').map(s=>({anchor:s.anchor,text:s.label,depth:0})),
      ...(findings.length?[{anchor:findingsAnchor,text:labels.findings,depth:0},...findings.map(f=>({anchor:f.anchor,text:f.displayId+' '+f.title,depth:1}))]:[])];
    const enabled=reportSections.some(s=>s.kind==='contents')&&targets.length>0;
    contents={enabled,rows:enabled?targets:[]};
    if(!enabled)reportSections=reportSections.filter(s=>s.kind!=='contents');
    else reportSections=[...reportSections.filter(s=>s.kind==='contents'),...reportSections.filter(s=>s.kind!=='contents')];
  }
  reportSections=reportSections.map((section,index)=>({...section,pageBreakBefore:(!p.cover.enabled&&index===0)||(index===1&&reportSections[0].kind==='contents')||(section.kind==='summary'&&index>0)}));
  const boundLabel=(source,fallback)=>p.engagement.rows.find(r=>r.source===source)?.label??fallback;
  const details=[{label:labels.client,value:metadata.client},
    {label:boundLabel('engagementId','Engagement ID'),value:metadata.engagementId},
    {label:labels.version,value:metadata.reportVersion},{label:labels.date,value:metadata.reportDate},
    {label:boundLabel('testingPeriod','Testing period'),value:resolveEngagementValue({source:'testingPeriod'},p)},
    {label:boundLabel('testerName','Prepared by'),value:[metadata.organisation,metadata.testerName].filter(Boolean).join(' | ')}].filter(r=>r.value);
  const shortTitle=Array.from(metadata.title);
  return { version: v4?3:project.schemaVersion === 3 ? 2 : 1, paperSize, geometry, metadata, labels,design,...(v4?{contents,findingsAnchor}:{}),
    cover: { enabled: p.cover.enabled, logos: logosAt('front', 180, 70),details },
    running: { headerLogos,firstPageHeaderLogos:p.cover.enabled?headerLogos:headerLogos.filter(logo=>!p.branding[logo.role].front),footerLogos,title:shortTitle.length>56?shortTitle.slice(0,55).join('')+'\u2026':metadata.title,footerPrefix }, imageAssets: [...imageMap.values()], reportSections, summary, findings };
}
