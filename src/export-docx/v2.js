import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  SimpleField, HeadingLevel, AlignmentType, WidthType, LevelFormat, Tab, Bookmark, InternalHyperlink, SectionType, BorderStyle, TabStopType, XmlComponent } from 'docx';
import { createReportPlan } from './plan.js';
import {reportDesign,ratingBadge} from './design.js';
import { stripImageMetadata } from '../app/image-metadata.js';
const BASE=reportDesign('253F78');
const rule=(color=BASE.line,size=4)=>({style:BorderStyle.SINGLE,color,size});
const noBorder={style:BorderStyle.NONE,color:'FFFFFF',size:0};
const tableBorders=(visible=true)=>Object.fromEntries(['top','bottom','left','right','insideHorizontal','insideVertical'].map(key=>[key,visible?rule():noBorder]));

// Word only: a non-breaking hyphen keeps "CWE-640" on one line in the narrow summary column
// (Word broke it at the hyphen). The plan, preview and CSV keep the ASCII text people copy and search.
const keepCweTogether=(t)=>t.replace(/\bCWE-(?=\d)/g,'CWE\u2011');
function runs(value) {
  return value.split('\t').flatMap((part, index) => [...(index ? [new TextRun({children:[new Tab()]})] : []), new TextRun(part)]);
}
function literalLine(value, style = 'Body',options={}) {
  return new Paragraph({style,children:runs(value),...options});
}
function literalLines(value,keepTogether=false) {
  const lines=value.split(/\r\n|\r|\n/);
  return lines.map((line,i)=>literalLine(line,'Body',keepTogether?{keepNext:i<lines.length-1}:{}));
}
function paragraphs(value, format = 'plain',keepTogether=false) {
  // A lone CR is a line boundary as well; no characters are interpreted as markup.
  const lines=value.split(/\r\n|\r|\n/);
  const visible=format==='code'?lines:lines.filter(line=>line.trim());
  return visible.map((line,index) => {
    const bullet = format !== 'code' && line.startsWith('- ');
    return new Paragraph({ style: format === 'code' ? 'Code' : 'Body', children: runs(bullet ? line.slice(2) : line),
      ...(format==='code'?{shading:{fill:BASE.codeFill},border:{top:rule(BASE.codeBorder),bottom:rule(BASE.codeBorder),left:rule(BASE.codeBorder),right:rule(BASE.codeBorder)},indent:{left:120,right:120}}:{}),
      ...(format!=='code'&&line.trim().endsWith(':')?{keepNext:true}:{}),
      ...(keepTogether?{keepNext:index<visible.length-1}:{}),
      ...(bullet?{keepLines:true}:{}),
      ...(bullet ? {numbering:{reference:'body-bullets',level:0}} : {}) });
  });
}
function imageBytes(image) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl ?? '');
  if (!match || image.mime !== 'image/' + match[1]) throw new Error('Invalid image format: ' + image.id);
  const data = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  if (!data.length || data.length !== image.bytes || data.length > 2097152) throw new Error('Invalid image bytes: ' + image.id);
  if (image.mime === 'image/png' ? !(data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) : !(data[0] === 255 && data[1] === 216 && data[2] === 255)) throw new Error('Invalid image signature: ' + image.id);
  // Older projects can hold screenshots with metadata; the report never carries it.
  const clean = stripImageMetadata(data, image.mime);
  if (!clean) throw new Error('Screenshot ' + image.id + ' could not be checked for hidden data. Remove it and add it again.');
  return {data: clean, type: match[1] === 'jpeg' ? 'jpg' : 'png'};
}
function drawing(image, dimensions, name, description) {
  return new ImageRun({...imageBytes(image), transformation: {width:dimensions.width,height:dimensions.height},
    altText:{title:name, name, description}});
}
async function* evidenceParts(image, parts) {
  if (parts.length === 1) { yield {part:parts[0], ...imageBytes(image)}; return; }
  if (typeof document === 'undefined') throw new Error('Split images require browser canvas.');
  const source = await new Promise((resolve,reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Image decode failed: ' + image.id)); img.src = image.dataUrl;
  });
  if (source.naturalWidth !== image.width || source.naturalHeight !== image.height) throw new Error('Image dimensions changed.');
  for (const part of parts) {
    const canvas = document.createElement('canvas'); canvas.width = part.sourceWidth; canvas.height = part.sourceHeight;
    try {
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable.');
      ctx.drawImage(source,0,part.y,part.sourceWidth,part.sourceHeight,0,0,part.sourceWidth,part.sourceHeight);
      const url = canvas.toDataURL('image/png');
      yield {part, data:Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0)),type:'png'};
    } finally { canvas.width = canvas.height = 1; }
  }
}
function link(anchor,text,options={}) {
  return new InternalHyperlink({anchor,children:[new TextRun({text,color:'245899',underline:{},...options})]});
}
function summaryTable(plan) {
  const d=plan.design,columns=plan.summary.columns;
  const row=(values,header,index=0)=>new TableRow({tableHeader:header,cantSplit:true,children:columns.map((c,i)=>{
    const badge=!header?values.badges[c.key]:null,fill=header?d.accent:badge?.fill??(index%2?d.soft:'FFFFFF');
    const opts={size:(!header&&c.key==='id'?plan.summary.idFontPt:d.tablePt)*2,bold:header||!!badge,color:header?d.onAccent:badge?.textColor??d.ink};
    const children=header?[new TextRun({text:c.label,...opts})]:c.key==='title'?[link(values.anchor,values.title,{size:d.tablePt*2})]:[new TextRun({text:c.key==='classification'?keepCweTogether(values.values[c.key]):values.values[c.key],...opts})];
    // Only the last data row joins the counts. Earlier rows remain free to paginate.
    const keepCounts=!header&&index===plan.summary.rows.length-1&&plan.summary.countTables.length>0;
    const cell=new TableCell({width:{size:c.widthPct,type:WidthType.PERCENTAGE},margins:d.cellPadding,verticalAlign:'center',shading:{fill},children:[new Paragraph({style:'Body',...(keepCounts?{keepNext:true}:{}),spacing:{after:0,line:240},children})]});
    if(!header&&c.key==='id'){
      // docx 9.5.1 has no noWrap option. Add its OOXML element in tcPr order,
      // before tcMar (and vAlign), without changing the literal ID characters.
      const properties=cell.root[0];
      if(properties.rootKey!=='w:tcPr'||!Array.isArray(properties.root))throw new Error('Unsupported pinned docx cell structure.');
      const at=properties.root.findIndex(p=>p.rootKey==='w:tcMar');
      properties.root.splice(at<0?properties.root.length:at,0,new XmlComponent('w:noWrap'));
    }
    return cell;
  })});
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:columns.map(c=>c.widthTwips),borders:tableBorders(),rows:[row(null,true),...plan.summary.rows.map((r,i)=>row(r,false,i))]});
}
function countTables(plan) {
  const d=plan.design;
  return plan.summary.countTables.flatMap((table,index)=>{
    const columns=[{key:'label',label:table.label,count:table.rowLabel,badge:null},...table.columns],size=100/columns.length;
    const row=header=>new TableRow({tableHeader:header,cantSplit:true,children:columns.map((c,i)=>new TableCell({
      width:{size,type:WidthType.PERCENTAGE},margins:d.countCellPadding,verticalAlign:'center',
      shading:{fill:header?(i===0?d.accent:c.badge?.fill??d.labelFill):c.key==='total'?d.labelFill:'FFFFFF'},
      children:[new Paragraph({style:'Body',alignment:i===0?AlignmentType.LEFT:AlignmentType.CENTER,keepNext:true,spacing:{after:0,line:220},children:[new TextRun({text:header?c.label:String(c.count),
        size:d.countTablePt*2,bold:header||c.key==='total',color:header&&i===0?d.onAccent:header?c.badge?.textColor??d.ink:d.ink})]})],
    }))});
    return [new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:columns.map(()=>Math.round(plan.geometry.contentWidth*15/columns.length)),borders:tableBorders(),rows:[row(true),row(false)]}),new Paragraph({text:'',keepNext:index<plan.summary.countTables.length-1||!!plan.summary.statusNote,spacing:{before:0,after:80}})];
  });
}
function engagementTable(rows,{cover=false}={}) {
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:tableBorders(!cover),rows:rows.map(row=>new TableRow({children:[
    new TableCell({width:{size:28,type:WidthType.PERCENTAGE},margins:BASE.cellPadding,...(!cover?{shading:{fill:BASE.labelFill}}:{}),children:[new Paragraph({style:'Body',spacing:{after:0,...(cover?{line:276}:{})},children:[new TextRun({text:row.label,bold:true,size:20,color:BASE.muted})]})]}),
    new TableCell({width:{size:72,type:WidthType.PERCENTAGE},margins:BASE.cellPadding,children:row.literal?[literalLine(row.value,'Body',{spacing:{after:0,...(cover?{line:276}:{})}})]:paragraphs(row.value,row.format)}),
  ]}))});
}
function logosParagraph(logos,assets,width) {
  const tester=logos.find(l=>l.role==='testerLogo'),client=logos.find(l=>l.role==='clientLogo');
  return new Paragraph({spacing:{before:0,after:0,line:Math.ceil((Math.max(0,...logos.map(l=>l.height))+8)*15),lineRule:'atLeast'},tabStops:[{type:TabStopType.RIGHT,position:Math.round(width*15)}],children:[
    ...(tester?[drawing(assets.get(tester.imageId),tester,'testerLogo','Tester logo')]:[]),
    ...(client?[new TextRun({children:[new Tab()]}),drawing(assets.get(client.imageId),client,'clientLogo','Customer logo')]:[]),
  ]});
}
function keyFactsTable(finding) {
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:tableBorders(),rows:finding.keyFacts.map(f=>new TableRow({cantSplit:true,children:[
    new TableCell({width:{size:28,type:WidthType.PERCENTAGE},margins:BASE.cellPadding,shading:{fill:BASE.labelFill},children:[new Paragraph({style:'Body',spacing:{after:0},children:[new TextRun({text:f.label,bold:true,size:20,color:BASE.muted})]})]}),
    new TableCell({width:{size:72,type:WidthType.PERCENTAGE},margins:BASE.cellPadding,...(f.badge?{shading:{fill:f.badge.fill}}:{}),children:[
      new Paragraph({style:'Body',spacing:{after:f.detail?80:0},children:[new TextRun({text:f.value,bold:!!f.badge,color:f.badge?.textColor??BASE.ink})]}),
      ...(f.detail?[new Paragraph({style:'Code',spacing:{after:0},children:[new TextRun({text:f.detail,color:f.badge?.textColor??BASE.ink})]})]:[]),
    ]}),
  ]}))});
}
function front(plan,assets,cover) {
  const p=plan.metadata,d=plan.design,children=[];
  if(cover){
    children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:{...tableBorders(false),top:rule(d.accent,32)},rows:[new TableRow({children:[new TableCell({margins:{top:220,bottom:220,left:220,right:220},shading:{fill:d.soft},children:[logosParagraph(plan.cover.logos,assets,plan.geometry.contentWidth-440/15)]})]})]}),new Paragraph({text:'',spacing:{before:0,after:680}}));
  }else if(plan.cover.logos.length)children.push(logosParagraph(plan.cover.logos,assets,plan.geometry.contentWidth));
  children.push(new Paragraph({style:'Title',children:[new TextRun({text:p.title,size:(cover?d.titlePt:d.compactTitlePt)*2})],spacing:{before:cover?120:160,after:240}}));
  if(p.subtitle)children.push(new Paragraph({style:'Subtitle',children:runs(p.subtitle)}));
  children.push(new Paragraph({text:'',spacing:{before:0,after:180},border:{bottom:rule(d.accent,10)}}));
  if(plan.cover.details.length)children.push(engagementTable(plan.cover.details.map(r=>({...r,literal:true})),{cover:true}));
  if(p.classification)children.push(new Paragraph({style:'Classification',spacing:{before:cover?600:200,after:120},shading:{fill:d.labelFill},children:[new TextRun({text:p.classification,bold:true,color:d.accent})]}));
  return children;
}

/** Validated v2/v3/v4/v5 document to genuine OOXML; no writes or external resources. */
export async function exportDocxV2(project, options = {}) {
  const plan = createReportPlan(project,options), p = plan.metadata;
  const assets = new Map(plan.imageAssets.map(image=>[image.id,image]));
  // Check every stored asset, including disabled/hidden evidence, before packing.
  for (const image of assets.values()) imageBytes(image);
  const accent = p.accentColor.slice(1), children = plan.cover.enabled ? [] : front(plan,assets,false);
  for (const section of plan.reportSections) {
    const anchor=section.anchor??(section.kind==='summary'?plan.summary.anchor:null);
    const title = anchor ? [new Bookmark({id:anchor,children:[new TextRun(section.label)]})] : [new TextRun(section.label)];
    children.push(new Paragraph({heading:HeadingLevel.HEADING_1,...(section.pageBreakBefore?{pageBreakBefore:true}:{}),children:title}));
    if(section.kind==='contents')children.push(...plan.contents.rows.map(r=>new Paragraph({style:'Body',indent:{left:r.depth*240},children:[link(r.anchor,r.text)]})));
    else if (section.kind === 'summary') children.push(summaryTable(plan),new Paragraph({text:'',keepNext:plan.summary.countTables.length>0,spacing:{after:100}}),...countTables(plan),...(plan.summary.statusNote?[new Paragraph({style:'Body',keepLines:true,spacing:{before:0,after:80},children:[new TextRun({text:plan.summary.statusNote,size:17,color:plan.design.muted})]})]:[]));
    else if (section.kind === 'engagement') children.push(engagementTable(section.rows));
    else children.push(...paragraphs(section.text,section.format));
  }
  if (plan.findings.length) children.push(new Paragraph({heading:HeadingLevel.HEADING_1,pageBreakBefore:true,...(plan.findingsAnchor?{children:[new Bookmark({id:plan.findingsAnchor,children:[new TextRun(plan.labels.findings)]})]}:{text:plan.labels.findings})}));
  for (const [index,finding] of plan.findings.entries()) {
    children.push(new Paragraph({heading:HeadingLevel.HEADING_1,...(index > 0 ? {pageBreakBefore:true} : {}),
      children:[new Bookmark({id:finding.anchor,children:[new TextRun({text:finding.displayId+' ',color:accent}),new TextRun(finding.title)]})]}));
    children.push(keyFactsTable(finding));
    if (finding.backToSummary) children.push(new Paragraph({style:'Body',alignment:AlignmentType.RIGHT,spacing:{before:100,after:160},children:[link(plan.summary.anchor,plan.labels.backToSummary,{size:18})]}));
    for (const section of finding.sections) {
      children.push(new Paragraph({text:section.label,heading:HeadingLevel.HEADING_2}));
      if (section.kind === 'text') { children.push(...(section.literal ? literalLines(section.text,section.keepTogether) : paragraphs(section.text,section.format,section.keepTogether))); continue; }
      if(section.kind==='references'){
        for(const row of section.rows){children.push(literalLine(row.title,'Body',{keepNext:!!row.url}));if(row.url)children.push(literalLine(row.url,'Body',{wordWrap:true,keepLines:true}));}
        continue;
      }
      const blocks = section.kind === 'blocks' ? section.blocks : section.images.map(image=>({kind:'evidence',image}));
      for (const block of blocks) {
        if (block.kind === 'text') { children.push(...paragraphs(block.text,block.format)); continue; }
        const evidence = block.image;
        for await (const {part,data,type} of evidenceParts(assets.get(evidence.imageId),evidence.parts)) {
          children.push(new Paragraph({keepNext:true,spacing:{before:BASE.imageBeforePt*20,after:BASE.imageAfterPt*20},children:[new ImageRun({data,type,
            transformation:{width:part.width,height:part.height},
            altText:{title:evidence.imageId,name:evidence.imageId+'_'+part.index,description:evidence.caption+part.captionSuffix}})]}));
          children.push(new Paragraph({style:'Caption',children:[new TextRun(plan.labels.figure+' '),
            new SimpleField(part.sequence === 'increment' ? 'SEQ Figure \\* ARABIC' : 'SEQ Figure \\c',String(evidence.figure)),
            new TextRun(' '+evidence.caption+part.captionSuffix)]}));
        }
      }
    }
  }
  // A standalone empty body still needs a paragraph and a section.
  if (!children.length) children.push(new Paragraph(''));
  const geom = plan.geometry;
  const page = {size:{width:Math.round(geom.pageWidth*15),height:Math.round(geom.pageHeight*15)},
    margin:Object.fromEntries([...Object.entries(geom.margin).map(([key,val])=>[key,Math.round(val*15)]),['header',500],['footer',500]])};
  const headerFor=logos=>new Header({children:[...(logos.length?[logosParagraph(logos,assets,geom.contentWidth)]:[]),
    new Paragraph({style:'Running',spacing:{before:60,after:80},border:{bottom:rule()},children:[new TextRun(plan.running.title)]})]});
  const header=headerFor(plan.running.headerLogos),footerChildren=[];
  if(plan.running.footerLogos.length)footerChildren.push(logosParagraph(plan.running.footerLogos,assets,geom.contentWidth));
  footerChildren.push(new Paragraph({style:'Running',spacing:{before:80,after:0},border:{top:rule()},tabStops:[{type:TabStopType.RIGHT,position:Math.round(geom.contentWidth*15)}],children:[
    new TextRun(plan.running.footerPrefix),new TextRun({children:[new Tab()]}),new TextRun(plan.labels.page+' '),
    new SimpleField('PAGE','1'),new TextRun(' '+plan.labels.pageOf+' '),new SimpleField('SECTIONPAGES','1'),
  ]}));
  const sections = [];
  if (plan.cover.enabled) sections.push({properties:{page,type:SectionType.NEXT_PAGE},
    headers:{default:new Header({children:[new Paragraph('')]})},footers:{default:new Footer({children:[new Paragraph('')]})},children:front(plan,assets,true)});
  const bodyFooter=new Footer({children:footerChildren});
  sections.push({properties:{page:{...page,pageNumbers:{start:1}},type:SectionType.NEXT_PAGE,titlePage:!plan.cover.enabled},
    headers:plan.cover.enabled?{default:header}:{default:header,first:headerFor(plan.running.firstPageHeaderLogos)},
    footers:plan.cover.enabled?{default:bodyFooter}:{default:bodyFooter,first:bodyFooter},children});
  const doc = new Document({creator:'',lastModifiedBy:'',title:p.title,description:'',
    numbering:{config:[{reference:'body-bullets',levels:[{level:0,format:LevelFormat.BULLET,text:'\u2022',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:360,hanging:180}}}}]}]},
    styles:{default:{title:{run:{size:64,bold:true,color:'000000'},paragraph:{spacing:{before:240,after:240}}},
      heading1:{run:{size:34,bold:true,color:BASE.ink},paragraph:{keepNext:true,spacing:{before:260,after:180},border:{bottom:rule(accent,6)}}},
      heading2:{run:{size:24,bold:true,color:accent},paragraph:{keepNext:true,spacing:{before:BASE.heading2BeforePt*20,after:BASE.heading2AfterPt*20}}},
      document:{run:{font:BASE.bodyFont,size:22,color:BASE.ink},paragraph:{spacing:{after:140,line:276}}}},paragraphStyles:[
      {id:'Body',name:'Body',basedOn:'Normal',next:'Body',paragraph:{widowControl:true,spacing:{after:BASE.bodyAfterPt*20,line:BASE.bodyLinePt*20}}},
      {id:'Code',name:'Code',basedOn:'Normal',next:'Code',run:{font:BASE.codeFont,size:18,color:BASE.ink},paragraph:{spacing:{after:0,line:BASE.codeLinePt*20},wordWrap:true}},
      {id:'Caption',name:'Caption',basedOn:'Normal',next:'Body',run:{size:19,color:'52647A'},paragraph:{spacing:{after:BASE.captionAfterPt*20}}},
      {id:'Subtitle',name:'Subtitle',basedOn:'Normal',next:'Body',run:{size:28,color:BASE.muted},paragraph:{spacing:{after:260,line:320}}},
      {id:'Running',name:'Running',basedOn:'Normal',next:'Body',run:{size:16,color:BASE.muted},paragraph:{spacing:{after:0,line:200}}},
      {id:'Classification',name:'Classification',basedOn:'Normal',next:'Body',run:{size:20,bold:true,color:accent},paragraph:{spacing:{after:120},indent:{left:120,right:120}}},
    ]},sections});
  const zip = await JSZip.loadAsync(await Packer.toArrayBuffer(doc)); let drawingId = 0;
  for (const name of Object.keys(zip.files).filter(n=>/^word\/.*\.xml$/.test(n)).sort()) {
    const xml = await zip.file(name).async('string');
    zip.file(name,xml.replace(/(<wp:docPr\b[^>]*\bid=")[0-9]+(")/g,(_,a,b)=>a+(++drawingId)+b));
  }
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
}
