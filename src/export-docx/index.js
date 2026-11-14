import JSZip from 'jszip';
import { exportDocxV2 } from './v2.js';
import { cvssExportProblem } from '../scoring/index.js';
import { stripImageMetadata } from '../app/image-metadata.js';
/** DOCX-only exporter. Call with a schema-v1 project validated by the app. No I/O/network. */
import {
 Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
 Footer, SimpleField, HeadingLevel, AlignmentType, WidthType, LevelFormat, Tab,
} from 'docx';

const PAPERS = { A4: { width:11906,height:16838 }, Letter:{width:12240,height:15840} };
const MARGIN=1134; // 20 mm; all measurements in twips unless stated otherwise.
const XML_BAD=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
function text(v='') { if(typeof v!=='string'||XML_BAD.test(v)) throw Error('Invalid XML text.');return v; }
function runsWithTabs(line) {
 return line.split('\t').flatMap((part,i)=>[...(i?[new TextRun({children:[new Tab()]})]:[]),new TextRun(part)]);
}
function paragraphs(value,style='Body') {
 return text(value).split(/\r?\n/).map(line=>{
  const bullet=style!=='Code'&&line.startsWith('- ');
  return new Paragraph({style,children:runsWithTabs(bullet?line.slice(2):line),...(bullet?{numbering:{reference:'body-bullets',level:0}}:{})});
 });
}
function section(label,value,code=false) {
 const content=text(value??'');
 return content.trim()===''?[]:[new Paragraph({text:label,heading:HeadingLevel.HEADING_2}),...paragraphs(content,code?'Code':'Body')];
}
function decodeImage(image) {
 const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl||'');
 if(!match||image.mime!=='image/'+match[1])throw Error('Invalid image format: '+image.id);
 const data=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
 if(data.length!==image.bytes||data.length>2097152||data.length===0)throw Error('Invalid image byte length: '+image.id);
 if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>16000000)throw Error('Invalid image dimensions: '+image.id);
 const png=data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71;
 const jpeg=data[0]===255&&data[1]===216&&data[2]===255;
 if((match[1]==='png'&&!png)||(match[1]==='jpeg'&&!jpeg))throw Error('Invalid image signature: '+image.id);
 const clean=stripImageMetadata(data,image.mime);if(!clean)throw Error('Screenshot '+image.id+' could not be checked for hidden data. Remove it and add it again.');
 return {data:clean,type:match[1]==='jpeg'?'jpg':'png',width:image.width,height:image.height};
}
function fit(width,height,maxWidth,maxHeight) {const scale=Math.min(1,maxWidth/width,maxHeight/height);return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};}
/** Split into nonoverlapping pixel ranges in a browser; no external image URLs accepted. */
async function imageParts(image,maxWidth,maxHeight) {
 const decoded=decodeImage(image);
 if(!['fit','split'].includes(image.tallMode))throw Error('Invalid tall image mode.');
 const atWidth=Math.min(1,maxWidth/image.width);
 if(image.tallMode==='fit'||image.height*atWidth<=maxHeight)return [decoded];
 if(typeof document==='undefined')throw Error('Split images require the browser canvas path; choose fit for Node-only feasibility.');
 const source=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Image decode failed: '+image.id));im.src=image.dataUrl;});
 if(source.naturalWidth!==image.width||source.naturalHeight!==image.height)throw Error('Image metadata dimensions mismatch: '+image.id);
 const step=Math.max(1,Math.floor(maxHeight/atWidth)),parts=[];
 for(let top=0;top<image.height;top+=step){
  const height=Math.min(step,image.height-top),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable.');
  ctx.drawImage(source,0,top,image.width,height,0,0,image.width,height);
  const url=canvas.toDataURL('image/png');parts.push({data:Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0)),type:'png',width:image.width,height});
  canvas.width=1;canvas.height=1;
 }
 return parts;
}
function summary(findings,accent){
 const row=(values,header=false)=>new TableRow({tableHeader:header,cantSplit:true,children:values.map(value=>new TableCell({shading:header?{fill:accent}:undefined,children:[new Paragraph({style:'Body',children:[new TextRun({text:value,bold:header,color:header?'FFFFFF':'243249'})]})]}))});
 return new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[row(['ID','Finding','Severity'],true),...findings.map(f=>row([f.id,text(f.title),f.severity??'Unscored']))]});
}

/** @returns {Promise<Uint8Array>} Genuine OOXML package; UI owns native save/download. */
export async function exportDocx(project,{paperSize=project?.project?.paperSize}={}) {
 if(project?.schemaVersion>=7){const problem=cvssExportProblem(project);if(problem)throw Error(problem);}
 if([2,3,4,5,6,7,8].includes(project?.schemaVersion))return exportDocxV2(project,{paperSize});
 if(project?.format!=='fieldnote-project'||project.schemaVersion!==1||!PAPERS[paperSize])throw Error('Unsupported project or paper size.');
 if(!Array.isArray(project.findings)||project.findings.length>20||!Array.isArray(project.images)||project.images.length>31)throw Error('Project exceeds supported bounds.');
 const p=project.project,paper=PAPERS[paperSize],accent=/^#[0-9a-fA-F]{6}$/.test(p.accentColor||'')?p.accentColor.slice(1):'253F78';
 const imageMap=new Map();for(const im of project.images){if(imageMap.has(im.id))throw Error('Duplicate image id.');imageMap.set(im.id,im);}
 const referenced=project.findings.flatMap(f=>f.evidence||[]);
 if(referenced.length>30||new Set(referenced).size!==referenced.length)throw Error('Invalid evidence references.');
 const ids=new Set();for(const f of project.findings){if(!/^F-(?!000)[0-9]{3}$/.test(f.id)||ids.has(f.id))throw Error('Invalid or duplicate finding id.');ids.add(f.id);}
 const maxWidth=(paper.width-2*MARGIN)/15,maxImageHeight=(paper.height-2*MARGIN)/15-85;
 const children=[];
 if(p.logoImageId){const logo=imageMap.get(p.logoImageId);if(!logo||referenced.includes(p.logoImageId))throw Error('Invalid logo reference.');const data=decodeImage(logo);children.push(new Paragraph({children:[new ImageRun({...data,transformation:fit(data.width,data.height,180,70),altText:{title:'Organisation logo',description:'Organisation logo',name:'Logo'}})]}));}
 children.push(new Paragraph({text:text(p.title),style:'Title'}));
 children.push(...paragraphs(text(p.client||'')));
 children.push(...paragraphs([p.organisation,p.testerName,p.reportDate,p.reportVersion].filter(Boolean).map(text).join(' | ')));
 children.push(...section('Executive summary',p.executiveSummary||''),...section('Scope',p.scope||''));
 children.push(new Paragraph({text:'Findings summary',heading:HeadingLevel.HEADING_1}),summary(project.findings,accent));
 let figure=0;
 for(const f of project.findings){
  children.push(new Paragraph({text:f.id+' '+text(f.title),heading:HeadingLevel.HEADING_1,pageBreakBefore:true}));
  children.push(...paragraphs('Severity: '+(f.severity??'Unscored')));
  children.push(...section('Affected assets',(f.affectedAssets||[]).map(text).join('\n')),...section('Description',f.description||''),...section('Request and reproduction',f.reproduction||'',true),...section('Impact',f.impact||''),...section('Recommendation',f.recommendation||''));
  if(f.evidence?.length)children.push(new Paragraph({text:'Evidence',heading:HeadingLevel.HEADING_2}));
  for(const id of f.evidence||[]){
   const image=imageMap.get(id);if(!image)throw Error('Missing evidence '+id);
   const parts=await imageParts(image,maxWidth,maxImageHeight);figure++;
   for(let i=0;i<parts.length;i++){
    const part=parts[i],suffix=parts.length>1?' (part '+(i+1)+' of '+parts.length+')':'';
    children.push(new Paragraph({keepNext:true,spacing:{before:120,after:60},children:[new ImageRun({data:part.data,type:part.type,transformation:fit(part.width,part.height,maxWidth,maxImageHeight),altText:{title:id,description:text(image.caption)+suffix,name:id+suffix}})]}));
    // One SEQ increment per evidence, continuation parts retain its figure number.
    children.push(new Paragraph({style:'Caption',children:[new TextRun('Figure '),new SimpleField(i===0?'SEQ Figure \\* ARABIC':'SEQ Figure \\c',String(figure)),new TextRun(' '+text(image.caption)+suffix)]}));
   }
  }
 }
 const footer=new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:(p.classification?text(p.classification)+' | ':'')+'Page ',size:18,color:'64748B'}),new SimpleField('PAGE','1'),new TextRun(' of '),new SimpleField('NUMPAGES','1')]})]});
 const doc=new Document({numbering:{config:[{reference:'body-bullets',levels:[{level:0,format:LevelFormat.BULLET,text:'\u2022',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:360,hanging:180}}}}]}]},creator:'',lastModifiedBy:'',title:text(p.title),description:'',styles:{default:{title:{run:{size:44,bold:true,color:'000000'},paragraph:{spacing:{before:240,after:240}}},heading1:{run:{size:30,bold:true,color:accent},paragraph:{keepNext:true,spacing:{before:240,after:160}}},heading2:{run:{size:24,bold:true,color:accent},paragraph:{keepNext:true,spacing:{before:160,after:80}}},document:{run:{font:'Calibri',size:22,color:'243249'},paragraph:{spacing:{after:120,line:276}}}},paragraphStyles:[
  {id:'Body',name:'Body',basedOn:'Normal',next:'Body',paragraph:{widowControl:true}},
  {id:'Code',name:'Code',basedOn:'Normal',next:'Code',run:{font:'Consolas',size:17,color:'172B4D'},paragraph:{spacing:{after:0,line:220},wordWrap:true}},
  {id:'Caption',name:'Caption',basedOn:'Normal',next:'Body',run:{size:19,color:'52647A'},paragraph:{spacing:{after:180}}},
 ]},sections:[{properties:{page:{size:paper,margin:{top:MARGIN,right:MARGIN,bottom:MARGIN,left:MARGIN,footer:500,header:500}}},footers:{default:footer},children}]});
 // docx 9.5.1 emits duplicate wp:docPr ids. Normalize generated XML only,
 // across the whole package; no user-supplied XML/template is evaluated here.
 const zip=await JSZip.loadAsync(await Packer.toArrayBuffer(doc));
 let drawingId=0;
 for(const name of Object.keys(zip.files).filter(n=>/^word\/.*\.xml$/.test(n)).sort()) {
  const xml=await zip.file(name).async('string');
  zip.file(name,xml.replace(/(<wp:docPr\b[^>]*\bid=")[0-9]+(")/g,(_,before,after)=>before+(++drawingId)+after));
 }
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
}
