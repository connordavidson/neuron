from __future__ import annotations

import json
import secrets
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .common import load_json, write_json


def serve_annotations(manifest_path: Path, extracted_dir: Path, annotations_dir: Path, port: int = 8765,
                      open_browser: bool = True) -> None:
    manifest = load_json(manifest_path)
    token = secrets.token_urlsafe(24)
    annotations_dir.mkdir(parents=True, exist_ok=True)
    context = {
        "items": manifest.get("items", []),
        "extracted": extracted_dir.resolve(),
        "annotations": annotations_dir.resolve(),
        "token": token,
    }

    class Handler(AnnotationHandler):
        server_context = context

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/?token={token}"
    print(f"Annotation interface: {url}")
    if open_browser:
        threading.Timer(0.2, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


class AnnotationHandler(BaseHTTPRequestHandler):
    server_context: dict[str, Any]

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not self.authorized(parsed):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if parsed.path == "/":
            self.respond(INTERFACE_HTML.replace("__TOKEN__", self.server_context["token"]), "text/html; charset=utf-8")
            return
        if parsed.path == "/api/books":
            annotations = self.server_context["annotations"]
            books = [{
                "id": item["id"],
                "title": item.get("title", item["id"]),
                "split": item.get("split"),
                "doubleReview": item.get("split") in {"development", "locked-test"} and int(item["id"][:8], 16) % 5 == 0,
                "annotated": (annotations / f"{item['id']}.json").exists(),
            } for item in self.server_context["items"]]
            self.respond_json(books)
            return
        if parsed.path == "/api/book":
            book_id = parse_qs(parsed.query).get("id", [""])[0]
            if not self.valid_id(book_id):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            extraction_path = self.server_context["extracted"] / f"{book_id}.json"
            annotation_path = self.server_context["annotations"] / f"{book_id}.json"
            if not extraction_path.exists():
                self.send_error(HTTPStatus.NOT_FOUND, "Extract this book first")
                return
            extraction = load_json(extraction_path)
            payload = {
                "id": book_id,
                "metadata": extraction.get("metadata", {}),
                "outlines": extraction.get("outlines", []),
                "pages": [{"index": page.get("index", index), "label": page.get("label"), "text": page.get("text", "")}
                          for index, page in enumerate(extraction.get("structuredPages", []))],
                "annotation": load_json(annotation_path) if annotation_path.exists() else None,
            }
            self.respond_json(payload)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/annotation" or not self.authorized(parsed):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 1_000_000:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        try:
            payload = json.loads(self.rfile.read(length))
            validate_annotation(payload)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_error(HTTPStatus.BAD_REQUEST, str(error))
            return
        if not self.valid_id(payload["bookId"]):
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        write_json(self.server_context["annotations"] / f"{payload['bookId']}.json", payload)
        self.respond_json({"saved": True})

    def authorized(self, parsed: Any) -> bool:
        query_token = parse_qs(parsed.query).get("token", [""])[0]
        header_token = self.headers.get("X-Neuron-Token", "")
        return secrets.compare_digest(query_token or header_token, self.server_context["token"])

    def valid_id(self, book_id: str) -> bool:
        return bool(book_id) and any(item.get("id") == book_id for item in self.server_context["items"])

    def respond_json(self, value: Any) -> None:
        self.respond(json.dumps(value, ensure_ascii=False), "application/json; charset=utf-8")

    def respond(self, value: str, content_type: str) -> None:
        encoded = value.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        return


def validate_annotation(value: dict[str, Any]) -> None:
    if value.get("schemaVersion") != 1 or not isinstance(value.get("bookId"), str):
        raise ValueError("Invalid annotation header")
    if not isinstance(value.get("title"), str) or not value["title"].strip():
        raise ValueError("A canonical title is required")
    if not isinstance(value.get("readingStartPage"), int) or value["readingStartPage"] < 0:
        raise ValueError("Reading start must be a zero-based page index")
    if not isinstance(value.get("reviewers"), list) or not value["reviewers"]:
        raise ValueError("At least one reviewer is required")
    for section in value.get("sections", []):
        if not all(key in section for key in ("title", "kind", "startPage", "level")):
            raise ValueError("Every section requires title, kind, startPage, and level")
    block_kinds = {"heading", "prose", "footnote", "caption", "table", "reference", "decorative"}
    for block in value.get("blocks", []):
        if not isinstance(block.get("text"), str) or block.get("kind") not in block_kinds:
            raise ValueError("Every block requires text and a recognized block kind")
        if not isinstance(block.get("pageIndex"), int) or block["pageIndex"] < 0:
            raise ValueError("Every block requires a zero-based page index")


INTERFACE_HTML = r'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neuron corpus annotation</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f2ed;color:#211f27;font:14px/1.45 system-ui,sans-serif}main{display:grid;grid-template-columns:260px 1fr 430px;height:100vh}
aside,section{overflow:auto;padding:18px;border-right:1px solid #ddd7e1}.book{display:block;width:100%;padding:10px;border:0;border-radius:10px;background:transparent;text-align:left}.book:hover,.book.active{background:#e7e0f7}
h1{font:700 24px Georgia,serif;margin:0 0 12px}h2{font:700 18px Georgia,serif}.page{white-space:pre-wrap;background:white;border-radius:14px;padding:28px;min-height:70vh;box-shadow:0 5px 20px #30254212}
input,select,button,textarea{font:inherit}input,select,textarea{width:100%;padding:8px;border:1px solid #ccc4d1;border-radius:8px;background:white}.row{display:grid;grid-template-columns:1.4fr 1fr 70px 50px 30px;gap:6px;margin:7px 0}.blockRow{display:grid;grid-template-columns:1.5fr 1fr 70px 30px;gap:6px;margin:7px 0}.actions{display:flex;gap:8px;margin:12px 0}.primary{background:#6558d3;color:white;border:0;border-radius:10px;padding:10px 14px}.quiet{border:1px solid #cfc7d7;background:white;border-radius:10px;padding:8px}.meta{color:#746e7a;font-size:12px}.flag{color:#a33144;font-weight:700}.field{display:block;margin:8px 0}textarea{min-height:58px;resize:vertical}
</style></head><body><main><aside><h1>Corpus</h1><div id="books"></div></aside><section><div class="actions"><button class="quiet" id="prev">Previous page</button><button class="quiet" id="next">Next page</button><span id="pageMeta" class="meta"></span></div><div id="page" class="page">Choose a book.</div></section><aside><h2>Gold annotation</h2><label class="field">Canonical title<input id="title"></label><label class="field">Reading start page<input id="start" type="number" min="0"></label><label class="field">Body word count<input id="bodyWords" type="number" min="0"></label><label class="field">Running headers and footers<textarea id="furniture" placeholder="one normalized value per line"></textarea></label><label class="field">Sentence-end anchors<textarea id="sentenceEnds" placeholder="one stable anchor per line"></textarea></label><label class="field">Reviewer names<input id="reviewers" placeholder="name, second reviewer"></label><div class="actions"><button class="quiet" id="add">Add section</button><button class="quiet" id="addBlock">Label current block</button><button class="primary" id="save">Save</button></div><div id="reviewFlag" class="flag"></div><h2>Sections</h2><div id="sections"></div><h2>Block labels</h2><div id="blocks"></div><p id="status" class="meta"></p></aside></main>
<script>
const token='__TOKEN__', kinds=['cover','titlePage','copyright','dedication','contents','foreword','preface','acknowledgments','introduction','part','chapter','section','conclusion','epilogue','appendix','glossary','notes','bibliography','index','aboutAuthor','colophon','unknownFront','body','unknownBack'],blockKinds=['heading','prose','footnote','caption','table','reference','decorative'];let current=null,pageIndex=0,rows=[],blockRows=[];
const titleInput=document.querySelector('#title'),startInput=document.querySelector('#start'),bodyWordsInput=document.querySelector('#bodyWords'),furnitureInput=document.querySelector('#furniture'),sentenceEndsInput=document.querySelector('#sentenceEnds'),reviewersInput=document.querySelector('#reviewers'),reviewFlag=document.querySelector('#reviewFlag'),pageView=document.querySelector('#page'),pageMeta=document.querySelector('#pageMeta'),statusView=document.querySelector('#status');
const previousButton=document.querySelector('#prev'),nextButton=document.querySelector('#next'),addButton=document.querySelector('#add'),addBlockButton=document.querySelector('#addBlock'),saveButton=document.querySelector('#save');
const api=(path,options={})=>fetch(path,{...options,headers:{'Content-Type':'application/json','X-Neuron-Token':token,...options.headers}}).then(r=>{if(!r.ok)throw Error(r.statusText);return r.json()});
api('/api/books').then(books=>{const root=document.querySelector('#books');books.forEach(book=>{const button=document.createElement('button');button.className='book';button.textContent=(book.annotated?'✓ ':'')+book.title;button.onclick=()=>loadBook(book,button);root.append(button)})});
async function loadBook(book,button){document.querySelectorAll('.book').forEach(x=>x.classList.remove('active'));button.classList.add('active');current=await api('/api/book?id='+encodeURIComponent(book.id));pageIndex=0;const a=current.annotation||{};titleInput.value=a.title||current.metadata.title||book.title;startInput.value=a.readingStartPage||0;bodyWordsInput.value=a.bodyWordCount||0;furnitureInput.value=(a.runningFurniture||[]).join('\n');sentenceEndsInput.value=(a.sentenceEnds||[]).join('\n');reviewersInput.value=(a.reviewers||[]).join(', ');rows=a.sections||current.outlines.map(x=>({title:x.title,kind:'section',startPage:x.pageIndex,level:x.level}));blockRows=a.blocks||[];reviewFlag.textContent=book.doubleReview?'This book is in the deterministic 20% double-review sample.':'';renderPage();renderRows();renderBlockRows()}
function renderPage(){if(!current)return;const p=current.pages[pageIndex];pageView.textContent=p?.text||'(empty page)';pageMeta.textContent=`PDF page ${pageIndex+1} of ${current.pages.length}${p?.label?' · label '+p.label:''}`}
function renderRows(){const root=document.querySelector('#sections');root.innerHTML='';rows.forEach((row,i)=>{const div=document.createElement('div');div.className='row';div.innerHTML=`<input value="${escapeHTML(row.title)}"><select>${kinds.map(k=>`<option ${k===row.kind?'selected':''}>${k}</option>`).join('')}</select><input type="number" min="0" value="${row.startPage}"><input type="number" min="0" value="${row.level}"><button class="quiet">×</button>`;const inputs=div.querySelectorAll('input,select');inputs[0].oninput=e=>row.title=e.target.value;inputs[1].onchange=e=>row.kind=e.target.value;inputs[2].oninput=e=>row.startPage=Number(e.target.value);inputs[3].oninput=e=>row.level=Number(e.target.value);div.querySelector('button').onclick=()=>{rows.splice(i,1);renderRows()};root.append(div)})}
function renderBlockRows(){const root=document.querySelector('#blocks');root.innerHTML='';blockRows.forEach((row,i)=>{const div=document.createElement('div');div.className='blockRow';div.innerHTML=`<input value="${escapeHTML(row.text)}"><select>${blockKinds.map(k=>`<option ${k===row.kind?'selected':''}>${k}</option>`).join('')}</select><input type="number" min="0" value="${row.pageIndex}"><button class="quiet">×</button>`;const inputs=div.querySelectorAll('input,select');inputs[0].oninput=e=>row.text=e.target.value;inputs[1].onchange=e=>row.kind=e.target.value;inputs[2].oninput=e=>row.pageIndex=Number(e.target.value);div.querySelector('button').onclick=()=>{blockRows.splice(i,1);renderBlockRows()};root.append(div)})}
previousButton.onclick=()=>{if(current){pageIndex=Math.max(0,pageIndex-1);renderPage()}};nextButton.onclick=()=>{if(current){pageIndex=Math.min(current.pages.length-1,pageIndex+1);renderPage()}};addButton.onclick=()=>{rows.push({title:'',kind:'chapter',startPage:pageIndex,level:1});renderRows()};addBlockButton.onclick=()=>{const selection=window.getSelection()?.toString().trim()||'';blockRows.push({text:selection,kind:'prose',pageIndex});renderBlockRows()};saveButton.onclick=async()=>{if(!current)return;statusView.textContent='Saving…';const lines=value=>value.split('\n').map(x=>x.trim()).filter(Boolean);await api('/api/annotation',{method:'POST',body:JSON.stringify({schemaVersion:1,bookId:current.id,title:titleInput.value,readingStartPage:Number(startInput.value),bodyWordCount:Number(bodyWordsInput.value),runningFurniture:lines(furnitureInput.value),sentenceEnds:lines(sentenceEndsInput.value),sections:rows,blocks:blockRows,reviewers:reviewersInput.value.split(',').map(x=>x.trim()).filter(Boolean)})});statusView.textContent='Saved.'};function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
</script></body></html>'''
