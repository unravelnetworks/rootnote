"""Generate deterministic schema-v1 synthetic fixtures from synthetic images."""
from pathlib import Path
import base64,json,hashlib
from PIL import Image,ImageDraw,ImageFont
import io
OUT=Path('product/tests/fixtures');OUT.mkdir(parents=True,exist_ok=True)
try:font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',24)
except OSError:font=ImageFont.load_default()
manifest=[];image_bytes={}
for i in range(30):
 w,h=(1280,3400)if i in [2,12,22,29]else((800,1200)if i%5==0 else(1280,720))
 im=Image.new('RGB',(w,h),'#f2f5fa');d=ImageDraw.Draw(im)
 d.rectangle((0,0,w,100),fill='#142137');d.text((28,30),f'SYNTHETIC EVIDENCE E-{i+1:03d}',font=font,fill='white')
 for y in range(120,h-55,90):
  d.line((20,y,w-20,y),fill='#c3cddd',width=1);d.text((28,y+10),f'Row y={y:04d} | example.test | sample {i+1:02d}',font=font,fill='#243d60')
 d.rectangle((20,h-50,w-20,h-10),fill='#247f5a');d.text((28,h-48),f'END OF EVIDENCE E-{i+1:03d}',font=font,fill='white')
 ext='jpg'if i%2 else'png';name=f'evidence-{i+1:03d}.{ext}';out=io.BytesIO();im.save(out,format='JPEG'if ext=='jpg'else'PNG',**({'quality':85}if ext=='jpg'else{}));b=out.getvalue();image_bytes[name]=b
 manifest.append(dict(file=name,mime='image/jpeg'if ext=='jpg'else'image/png',width=w,height=h,bytes=len(b),sha256=hashlib.sha256(b).hexdigest()))
def build(nfindings,nimages):
 images=[]
 for i,m in enumerate(manifest[:nimages]):
  images.append(dict(id=f'IMG-{i+1:04d}',mime=m['mime'],dataUrl='data:'+m['mime']+';base64,'+base64.b64encode(image_bytes[m['file']]).decode(),width=m['width'],height=m['height'],bytes=m['bytes'],sha256=m['sha256'],caption=f'Synthetic evidence {i+1} on example.test — beginning and END marker visible',tallMode='fit',originalName=m['file']))
 findings=[]
 for i in range(nfindings):
  findings.append(dict(id=f'F-{i+1:03d}',title=['Cross-account invoice access','Session boundary test','Information disclosure'][i%3]+f' example {i+1}',severity=['High','Medium','Informational'][i%3],affectedAssets=[f'https://app{i+1}.example.test/'],description='Synthetic example only. Unicode: café, Δ, שלום. XML escaping: <tag> & "quoted".\n\n- First observation\n- Second observation',reproduction='GET /api/invoices/1002 HTTP/1.1\nHost: example.test\nAuthorization: Bearer '+'A'*650+'\n\nHTTP/1.1 200 OK\n{"owner":"account-b"}',impact='An authenticated account could access another account’s data. Synthetic claim only.',recommendation='Enforce object-level authorization and add regression tests.',evidence=[im['id']for j,im in enumerate(images)if j%nfindings==i]))
 findings[-1]['impact']='' # optional empty-field coverage
 return dict(format='fieldnote-project',schemaVersion=1,appVersion='0.0.0-spike',createdAt='2026-11-01T00:00:00Z',savedAt='2026-11-01T00:00:00Z',project=dict(title='Web Application Security Assessment',client='Northstar Synthetic Ltd',testerName='Synthetic Tester',organisation='Independent Security Research',reportVersion='1.0',classification='CONFIDENTIAL',startDate='2026-10-20',endDate='2026-10-24',reportDate='2026-11-01',scope='example.test only\nRFC 5737 reserved address: 203.0.113.7',executiveSummary='A synthetic test report for validating editable Word output. Three priorities are illustrated.\n\nNo client or employer material is included.',paperSize='A4',accentColor='#253F78',logoImageId=None,nextFindingNumber=nfindings+1,nextImageNumber=nimages+1),findings=findings,images=images)
entries=[]
for name,nf,ni in [('small',3,6),('bounds',20,30)]:
 p=OUT/(name+'.json');p.write_text(json.dumps(build(nf,ni),ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');entries.append(dict(file=p.name,findings=nf,images=ni,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
(OUT/'manifest.json').write_text(json.dumps(entries,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps(entries))
