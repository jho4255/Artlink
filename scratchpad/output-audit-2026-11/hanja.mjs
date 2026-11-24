// 데모 공모의 한 작가 자료에 한자·이모지를 넣는다(대신 입력 API) — 데모 DB 전용(4001)
const API = 'http://localhost:4001/api';
const EX = Number(process.argv[2]);
const login = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gallery@artlink.com' }) })).json();
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
const rows = await (await fetch(`${API}/operations/${EX}/submissions`, { headers: H })).json();
const r = rows.find((x) => x.user.name === '강윤서');
const s = r.submission;
s.artworkList[0].title = '猫와 나 #1';
s.artworkList[1].medium = '장지에 水墨, 혼합재료';
s.cv.solo[0].content = '개인展 「빛의 결」, 갤러리 온, 서울';
s.note = { statement: (s.note?.statement || '') + '\n\n마지막으로, 고마운 사람들에게 ❤️ 를 보냅니다. 書畵同源.', sections: s.note?.sections || [] };
const res = await fetch(`${API}/operations/${EX}/submissions/${r.user.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ artworkList: s.artworkList, cv: s.cv, note: s.note, representativeIndex: s.representativeIndex ?? 0 }) });
console.log('PUT', res.status, (await res.text()).slice(0, 120));
