# Zen Weiqi + KataGo (ชุดเชื่อมต่อ)

ชุดนี้ต่อยอดจากไฟล์เกมที่มีชื่อผู้เล่นและแชทแล้ว โดยเพิ่มตัวเชื่อม KataGo WebGPU Search

## สิ่งที่รวมมาให้แล้ว
- `site/index.html` — เกมเดิม พร้อมตัวเชื่อม KataGo และ AI เดิมเป็น fallback
- `site/katago/kata-worker.js` — Worker จากซอร์ส KataGo พร้อมคำสั่ง cancel
- `site/katago/model-b10c128.bin.gz` — โมเดลสำรองขนาดเล็ก g170e-b10c128 ที่เก็บใน Repository
- `site/index.html` — มีโปรไฟล์ความยากทดลอง 4d–8d และ Pro/Pro Max พร้อมโหมดดูหมากย้อนหลังหลังจบเกม
- TF3 B11C768 — โหลดจากไฟล์ Network ทางการของ KataGo แบบ remote เมื่อเป็นคอมพิวเตอร์ที่เหมาะสม โดยไม่บรรจุไฟล์ขนาดใหญ่ไว้ใน Git/Netlify
- `site/_headers` — เปิด COOP/COEP ให้ WebAssembly threads และ SharedArrayBuffer ใช้งานได้บนโฮสต์
- `engine-src/` — ซอร์ส KataGo WebGPU ทั้งชุด
- `build-katago.sh` — Build ไฟล์ WASM/JS แล้วคัดลอกไฟล์ไปยัง `site/katago/`

## ต้อง Build ก่อนใช้งาน KataGo จริง
ไฟล์ ZIP ต้นฉบับเป็นซอร์สโค้ด ยังไม่มี `kataeval-mt.js` และ `kataeval-mt.wasm` ที่ผ่านการคอมไพล์ จึงยังไม่สามารถเปิดใช้ KataGo ในหน้าเว็บได้ทันที

ต้องมี Linux หรือ WSL พร้อม Emscripten SDK (emcc >= 6), CMake/เครื่องมือ C++ และ dependencies ที่ build script ต้องใช้

ตัวอย่างติดตั้ง Emscripten:
```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

จากนั้นกลับมาที่โฟลเดอร์แพ็กเกจ:
```bash
cd /path/to/zenweiqi_katago_package
bash build-katago.sh
```

สคริปต์จะสร้างและคัดลอก:
- `site/katago/kataeval-mt.js`
- `site/katago/kataeval-mt.wasm`
- `site/katago/model-b10c128.bin.gz`

## Build และทดสอบผ่าน GitHub Actions (ไม่ต้องติดตั้ง Emscripten ในคอมตัวเอง)
1. นำไฟล์ที่แก้ในแพ็กเกจเข้า repository แล้ว Push ไปยัง branch สำหรับตรวจสอบ (อย่าเพิ่ง Push ตรงเข้า `main` หาก Netlify deploy อัตโนมัติจาก `main`)
2. เปิด Pull Request จาก branch นั้นเข้า `main`; Workflow **Build and Validate Zen Weiqi KataGo WASM** จะ Build และรัน Chromium tests บน Pull Request
3. รอให้ทุกขั้นผ่าน แล้วดาวน์โหลด Artifact `zen-weiqi-netlify-site-tested` และ `zen-weiqi-katago-validation-report` จาก run นั้น ตรวจ report ว่า `outcome` เป็น `PASS`
4. Merge เข้า `main` หลังทดสอบผ่านแล้วเท่านั้น; Push ไป `main` จะรัน Workflow ซ้ำอีกครั้ง
5. หากจะ Deploy ด้วยตนเอง ให้ Deploy เฉพาะหลังผล Actions ผ่านและ report ยืนยันการเริ่ม Worker/thread pool, โหลดโมเดล, eval, search, cancel และการเดินหมากจริง

Workflow จะไม่อัปโหลด Netlify site artifact หากขั้นทดสอบล้มเหลว

หรือ Build ใน Linux/WSL ตามคำสั่งด้านบนก็ได้

## Deploy ไป Netlify
หลัง Build สำเร็จ ให้ Deploy **เนื้อหาภายในโฟลเดอร์ `site/`** เป็น publish directory (ต้องมี `_headers`, `index.html`, และโฟลเดอร์ `katago/` อยู่ระดับเดียวกัน)

ห้าม Deploy เฉพาะ `index.html` เพราะ engine worker, WASM และโมเดลต้องอยู่ด้วย

## ความเข้ากันได้
- ต้องเปิดผ่าน HTTPS และโฮสต์ต้องส่ง headers ใน `site/_headers`
- ต้องเป็นเบราว์เซอร์ที่รองรับ cross-origin isolation / SharedArrayBuffer / WebAssembly threads
- Engine จะเลือก WebGPU หากมี adapter; หากไม่มีจะลอง CPU (Eigen)
- หากอุปกรณ์หรือเบราว์เซอร์ไม่รองรับ threaded WASM หรือโหลด Engine ไม่สำเร็จ เกมจะกลับไปใช้ AI เดิม พร้อมแจ้งสถานะ
- มือถือจะจำกัด search worker สูงสุด 2 threads; คอมพิวเตอร์สูงสุด 6 threads
- threaded WASM build นี้ตั้ง initial memory 512MB ตามข้อจำกัดที่ระบุในซอร์ส จึงยังไม่รับประกันว่าจะทำงานได้บนมือถือทุกรุ่น

## โมเดลและระดับความยาก

- คอมพิวเตอร์ที่รองรับและมีหน่วยความจำอุปกรณ์ที่รายงานอย่างน้อย 8 GB จะลองโหลด `kata1-tf3-b11c768-s12382M-d6533M.bin.gz` จาก Network File ของ KataGo
- มือถือและการบังคับ `?cpu` ใช้โมเดล B10C128 ขนาดเล็กใน Repository
- หาก TF3 โหลดไม่ได้หรือ WebGPU ใช้งานไม่ได้ ระบบจะลอง B10C128 บน WebGPU ก่อน แล้วจึงลอง CPU Eigen
- TF3 มีพารามิเตอร์ประมาณ 70.4 ล้านตัวและมีต้นทุนการประเมินต่อ visit สูงกว่าโมเดลขนาดเล็ก จึงไม่ได้หมายความว่าจะเร็วกว่า B10C128 บนทุกอุปกรณ์
- ระดับ 4d–8d, Pro และ Pro Max เป็น **โปรไฟล์งบค้นหาแบบทดลอง** ไม่ใช่การรับรองว่าเทียบเท่าแรงก์มนุษย์จริง ต้องเทียบผลการแข่งขันกับผู้เล่นที่มีแรงก์อ้างอิงก่อน

แหล่งโมเดล TF3: https://katagotraining.org/networks/\nไฟล์ที่เว็บเรียกใช้ผ่าน GitHub Release asset: https://github.com/studioxchamp/zen-weiqi-katago/releases/download/kata1-tf3-b11c768-s12382M-d6533M/model-tf3-b11c768.bin.gz

## ทบทวนเกมและบันทึก SGF

- เมื่อจบเกมจากการนับคะแนน, ยอมแพ้ หรือหมดเวลา จะมีปุ่มเปิดโหมดทบทวนหมาก
- เลือกตาได้ตั้งแต่กระดานเริ่มต้นจนถึงตาสุดท้าย ด้วยปุ่มก่อนหน้า/ถัดไปและแถบเลื่อน
- โหมดทบทวนใช้ snapshot แยก ไม่แก้ไขกระดานหรือประวัติของเกมจริง
- ดาวน์โหลดไฟล์ `.sgf` เพื่อเปิดในโปรแกรมหมากล้อมอื่นหรือเก็บไว้อ่านในอนาคตได้
- SGF จะเก็บข้อมูลผู้เล่น, โคมิ, การต่อแต้ม/หินตั้งต้น และลำดับการเดินหมาก; สามารถนำเข้าในเว็บเพื่อดูหรือเล่นต่อได้
