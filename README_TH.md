# MeChampZ GO + KataGo จริง (WebGPU / CPU)

แพ็กเกจนี้เชื่อม **KataGo Search จริง** เข้ากับเกม `MeChampZGo.html` โดยคงหน้าตาเกม กระดาน 19×19, ระบบนาฬิกา, เล่นออนไลน์ 2 คนผ่าน PeerJS, แชท/รีแอ็กชัน, เซฟ/โหลด, Undo, SGF และระบบนับคะแนนกติกาพื้นที่แบบจีนที่ปรับปรุงแล้วไว้

## สิ่งที่เชื่อมต่อแล้ว

- ใช้ KataGo neural network และ search engine ผ่าน WebAssembly threaded build ไม่ใช่ตัวเลียนแบบหรือการเรียก API ภายนอก
- เลือก WebGPU เมื่ออุปกรณ์รองรับ และให้ KataGo เลือก Eigen CPU fallback เมื่อไม่มี WebGPU
- ส่งประวัติการเดินทั้งเกมให้ KataGo รวมถึง Pass และหมากต่อแต้ม เพื่อให้วิเคราะห์จากตำแหน่งเดียวกับกระดาน
- ควบคุมงบค้นหาและเวลาคิดต่อระดับ 8 คิว ถึง 3 ดั้ง (เป็นระดับความท้าทายโดยประมาณ ยังไม่ใช่ Rank ที่ผ่านการ calibrate)
- จำกัดจำนวน search threads สูงสุด 2 บนมือถือ และ 6 บนคอมพิวเตอร์
- ถ้าโหลดเอนจินไม่สำเร็จ จะกลับไปใช้ AI เดิม พร้อมแสดงสถานะให้ทราบ
- ยกเลิก search ที่ค้างเมื่อเริ่มเกมใหม่, Undo หรือเหตุการณ์ที่ยกเลิกตาคิด เพื่อไม่ให้ผลเก่ามาเดินบนกระดานใหม่
- โหมดนับคะแนนสามารถเลือกพื้นที่ดำ / ขาว / กลาง แล้วแตะจุดว่างเพื่อแก้การจัดเขตด้วยมือได้ พร้อมปุ่มกลับไปใช้การนับอัตโนมัติรายจุด
- การนับแบบพื้นที่จีนใช้คะแนนจากหมากที่ยังอยู่บนกระดาน + พื้นที่อาณาเขต + โคมิ; กลุ่มที่ตกลงว่าตายจะถูกนำออกก่อนนับพื้นที่ ไม่บวกเป็นคะแนนเชลยซ้ำ

## โครงสร้างแพ็กเกจ

- `site/index.html` — เกมฉบับใช้งานจริง
- `site/MeChampZGo.html` — ไฟล์เดียวกันในชื่อเดิม
- `site/katago/kata-worker.js` — Worker สำหรับ KataGo
- `site/katago/model-b10c128.bin.gz` — โมเดล KataGo จริง g170e-b10c128
- `site/_headers` — เปิด COOP/COEP แบบ credentialless สำหรับ SharedArrayBuffer และ WebAssembly threads พร้อมให้ CDN แบบ no-CORS โหลดได้
- `engine-src/` — ซอร์ส KataGo WebGPU และ build scripts
- `build-katago.sh` — คอมไพล์ WASM/JS และคัดลอก assets เข้า `site/`
- `.github/workflows/build-katago-wasm.yml` — GitHub Actions สำหรับ Build โดยไม่ต้องลง Emscripten ในเครื่อง

> ในแพ็กเกจต้นทางยังไม่มีไฟล์ `kataeval-mt.js` และ `kataeval-mt.wasm` ที่คอมไพล์เสร็จ ต้องสั่ง GitHub Actions Build ก่อน Deploy จึงจะใช้ KataGo จริงได้ ตัว HTML จะใช้ AI เดิมเป็น fallback ระหว่างที่ยังไม่มีไฟล์เหล่านี้

## วิธี Build ผ่าน GitHub Actions (แนะนำ)

1. แตก ZIP นี้ลงในเครื่อง
2. เปิดโฟลเดอร์ `MeChampZGo_KataGo_Integration` แล้วคัดลอก **ไฟล์และโฟลเดอร์ทั้งหมดภายใน** ไปไว้ที่รากของ GitHub repository ที่ใช้อยู่ (ต้องคัดลอกโฟลเดอร์ `.github` ด้วย)
3. เปิด GitHub Desktop แล้ว Commit และ Push ขึ้น GitHub
4. เปิด repository บน GitHub → แท็บ **Actions**
5. เลือก workflow ชื่อ **Build MeChampZ GO KataGo WASM** แล้วกด **Run workflow**
6. เมื่อ Build สำเร็จ เปิดรายการ Run นั้น แล้วดาวน์โหลด Artifact ชื่อ `mechampz-go-katago-site`
7. แตก Artifact แล้ว Deploy เนื้อหาข้างใน ซึ่งต้องมี `index.html`, `_headers` และโฟลเดอร์ `katago/` อยู่ระดับเดียวกัน ไปยัง Netlify หรือ Cloudflare Pages

Workflow นี้ Build จากซอร์สโดยใช้ Emscripten บน GitHub-hosted runner และอาจใช้เวลาหลายนาที การ Build ครั้งแรกยังต้องรอให้ Actions ทำงานเสร็จ ไม่ใช่แค่ Push HTML อย่างเดียว

## สำคัญเรื่องโฮสต์และมือถือ

- **ต้อง Deploy ผ่าน HTTPS และโฮสต์ต้องส่ง HTTP headers ใน `site/_headers`** เพื่อเปิด `Cross-Origin-Opener-Policy: same-origin` และ `Cross-Origin-Embedder-Policy: credentialless` สำหรับ threaded WebAssembly
- แนะนำ Netlify หรือ Cloudflare Pages ที่รองรับ `_headers`
- GitHub Pages ไม่รองรับกำหนด response headers ด้วยไฟล์ `_headers` โดยตรง จึงไม่เหมาะกับ threaded KataGo build นี้
- เปิดไฟล์ตรงด้วย `file://` หรือเปิดผ่าน HTTP/LAN ที่ไม่มี COOP/COEP จะใช้ KataGo จริงไม่ได้ และจะกลับไปใช้ AI เดิม
- WebGPU ใช้ได้ใน secure context (HTTPS หรือ localhost) หากไม่มี WebGPU ตัว WASM จะพยายามใช้ CPU (Eigen) แทน
- Build นี้จอง WebAssembly memory เริ่มต้น 512 MB และจำกัด worker บนมือถือแล้ว แต่ไม่สามารถรับประกันได้กับโทรศัพท์ทุกรุ่น/ทุกเบราว์เซอร์ หากหน่วยความจำหรือ threaded WASM ไม่พอ ระบบจะแจ้งสถานะและใช้ AI เดิม

## โมเดลและระดับความยาก

โมเดลที่แนบคือ `g170e-b10c128` ซึ่งเป็นโมเดล KataGo จริงจากชุดทดสอบ/โมเดลของ repository ไม่ใช่โมเดล b18/b20 ที่ใหญ่กว่า ระดับ 8k–3d ในหน้าจอเป็นการตั้งค่างบ visits, เวลา และ temperature เพื่อไล่ระดับความท้าทายเท่านั้น ยังไม่ได้ทดสอบแมตช์จำนวนมากเพื่อเทียบ Rank จริง จึงไม่ควรถือว่าเลือก 3d แล้วจะเท่ากับผู้เล่น 3 ดั้ง

## ไฟล์ต้นทางและลิขสิทธิ์

KataGo และส่วน WebGPU อ้างอิง repository `saigo-online/katago-webgpu` ซึ่งรวมซอร์สและไฟล์ LICENSE ไว้ใน `engine-src/` โปรดคงไฟล์ LICENSE และเครดิตไว้เมื่อเผยแพร่ต่อ


## หมายเหตุแก้ไขหน้าจอ (Fixed Layout)
ไฟล์ HTML ใช้การโหลด Tailwind Play CDN และ PeerJS แบบ classic no-CORS ตามรูปแบบต้นฉบับ (ไม่ใส่ `crossorigin="anonymous"`) เพื่อไม่บังคับ CORS กับ CDN ที่อาจไม่ส่ง `Access-Control-Allow-Origin` ในการเปิดไฟล์ตรงหรือบางโฮสต์ ส่วน COEP ใช้ `credentialless` เพื่อคง cross-origin isolation และ SharedArrayBuffer โดยส่งคำขอ cross-origin แบบ no-CORS โดยไม่แนบ credentials
