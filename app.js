const $ = id => document.getElementById(id);
let students = [];
let settings = {};

function money(n){ return "₦" + Number(n||0).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function esc(v){ return String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function toast(msg){ $("toast").textContent=msg; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),2500); }
async function api(url, opts={}) {
  const r = await fetch(url, {headers:{"Content-Type":"application/json",...(opts.headers||{})}, ...opts});
  if(!r.ok){
    let e={}; try{e=await r.json()}catch{}
    throw new Error(e.error || "Request failed");
  }
  return r.headers.get("content-type")?.includes("application/json") ? r.json() : r;
}

async function init(){
  const me = await api("/api/me");
  if(me.loggedIn) showApp(); else showLogin();
}
function showLogin(){ $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
function showApp(){ $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); loadAll(); }

$("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  try{
    await api("/api/login",{method:"POST",body:JSON.stringify({username:$("loginUser").value,password:$("loginPass").value})});
    $("loginMsg").textContent="";
    showApp();
  }catch(err){ $("loginMsg").textContent=err.message; }
});
$("logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});showLogin();};
$("backupBtn").onclick=()=>window.open("/api/backup.json","_blank");

document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
function showPage(page){
  document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));
  $("page-"+page).classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  if(page==="students")loadStudents();
  if(page==="attendance")loadAttendance();
  if(page==="classes")loadClasses();
  if(page==="fees")loadFees();
  if(page==="quran")loadQuran();
  if(page==="reports")buildReport();
  if(page==="settings")loadSettings();
}

async function loadAll(){
  try{
    await Promise.all([loadSettings(),loadDashboard(),loadStudents()]);
    populateStudentSelects();
  }catch(e){toast(e.message)}
}
async function loadDashboard(){
  const d=await api("/api/dashboard");
  $("statStudents").textContent=d.students;
  $("statClasses").textContent=d.classes;
  $("statFees").textContent=money(d.fees);
  $("statQuran").textContent=d.quranRecords;
  $("schoolAddress").textContent=settings.address||"—";
  $("schoolPhone").textContent=settings.phone||"—";
}
async function loadSettings(){
  settings=await api("/api/settings");
  $("schoolNameTop").textContent=settings.school_name;
  $("schoolAddress").textContent=settings.address;
  $("schoolPhone").textContent=settings.phone;
  $("set_school_name").value=settings.school_name;
  $("set_address").value=settings.address;
  $("set_phone").value=settings.phone;
}
async function loadStudents(){
  const q=encodeURIComponent($("studentSearch")?.value||""), c=encodeURIComponent($("studentClassFilter")?.value||""), g=encodeURIComponent($("studentGenderFilter")?.value||"");
  students=await api(`/api/students?search=${q}&class_level=${c}&gender=${g}`);
  $("studentsTable").innerHTML=students.map(s=>`
    <tr>
      <td>${esc(s.reg_no)}</td><td>${esc(s.full_name)}</td><td>${esc(s.class_level)}</td>
      <td>${esc(s.gender)}</td><td>${esc(s.guardian)}</td><td>${esc(s.guardian_phone)}</td>
      <td>
        <button onclick="editStudent('${s.id}')">Edit</button>
        <button onclick="viewStudent('${s.id}')">View</button>
        <button onclick="deleteStudent('${s.id}')">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="7">No students found.</td></tr>`;
  populateStudentSelects();
}
$("studentSearch").addEventListener("keydown",e=>{if(e.key==="Enter")loadStudents()});

function populateStudentSelects(){
  const opts='<option value="">Select student</option>'+students.map(s=>`<option value="${s.id}">${esc(s.full_name)} — ${esc(s.reg_no)}</option>`).join("");
  $("fee_student").innerHTML=opts;
  $("quran_student").innerHTML=opts;
}
function resetStudentForm(){
  $("studentForm").reset(); $("studentId").value=""; $("nationality").value="Nigerian";
  $("registerTitle").textContent="Register Student"; $("saveStudentBtn").textContent="Save Student";
}
function fillStudent(s){
  Object.keys(s).forEach(k=>{if($(k))$(k).value=s[k]??""});
  $("studentId").value=s.id;
  $("registerTitle").textContent="Edit Student";
  $("saveStudentBtn").textContent="Update Student";
  showPage("register");
}
async function editStudent(id){ const x=await api("/api/students/"+id+"/full"); fillStudent(x.student); }
async function deleteStudent(id){
  if(!confirm("Delete this student and their fee/Qur'an records?"))return;
  await api("/api/students/"+id,{method:"DELETE"});toast("Student deleted");await loadStudents();await loadDashboard();
}
async function viewStudent(id){
  const x=await api("/api/students/"+id+"/full");
  const s=x.student;
  const w=window.open("","_blank");
  w.document.write(`<html><head><title>${esc(s.full_name)}</title><style>
  body{font-family:Arial;padding:30px;color:#111}.head{text-align:center;border-bottom:2px solid #111;padding-bottom:15px}
  img{width:90px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}.box{border:1px solid #ddd;padding:10px}
  table{width:100%;border-collapse:collapse;margin-top:15px}td,th{border:1px solid #ddd;padding:8px;text-align:left}
  </style></head><body><div class="head"><img src="/logo.png"><h2>${esc(settings.school_name)}</h2><div>${esc(settings.address)} | ${esc(settings.phone)}</div></div>
  <h2>Student Profile</h2><div class="grid">
  <div class="box"><b>Registration No.</b><br>${esc(s.reg_no)}</div><div class="box"><b>Full Name</b><br>${esc(s.full_name)}</div>
  <div class="box"><b>Date of Birth</b><br>${esc(s.dob)}</div><div class="box"><b>Gender</b><br>${esc(s.gender)}</div>
  <div class="box"><b>Class</b><br>${esc(s.class_level)}</div><div class="box"><b>Programme</b><br>${esc(s.programme)}</div>
  <div class="box"><b>Guardian</b><br>${esc(s.guardian)}</div><div class="box"><b>Guardian Phone</b><br>${esc(s.guardian_phone)}</div>
  <div class="box"><b>State / LGA</b><br>${esc(s.state)} / ${esc(s.lga)}</div><div class="box"><b>Qur'an Level</b><br>${esc(s.quran_level)}</div>
  <div class="box"><b>Address</b><br>${esc(s.address)}</div><div class="box"><b>Medical / Notes</b><br>${esc(s.medical)} ${esc(s.notes)}</div></div>
  <h3>Fee Payments</h3><table><tr><th>Date</th><th>Type</th><th>Amount</th><th>Receipt</th></tr>${x.fees.map(f=>`<tr><td>${esc(f.payment_date)}</td><td>${esc(f.fee_type)}</td><td>${money(f.amount)}</td><td>${esc(f.receipt_no)}</td></tr>`).join("")||"<tr><td colspan=4>None</td></tr>"}</table>
  <h3>Qur'an Records</h3><table><tr><th>Date</th><th>Part</th><th>Status</th><th>Note</th></tr>${x.quran.map(q=>`<tr><td>${esc(q.record_date)}</td><td>${esc(q.part_name)}</td><td>${esc(q.status)}</td><td>${esc(q.note)}</td></tr>`).join("")||"<tr><td colspan=4>None</td></tr>"}</table>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
$("studentForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const data={};
  ["full_name","dob","gender","nationality","state","lga","class_level","programme","guardian","guardian_phone","alt_phone","previous_school","address","quran_level","medical","notes"].forEach(k=>data[k]=$(k).value);
  try{
    const id=$("studentId").value;
    if(id){await api("/api/students/"+id,{method:"PUT",body:JSON.stringify(data)});toast("Student updated");}
    else{const s=await api("/api/students",{method:"POST",body:JSON.stringify(data)});toast("Registered: "+s.reg_no);}
    resetStudentForm();await loadStudents();await loadDashboard();showPage("students");
  }catch(err){toast(err.message)}
});

function today(){return new Date().toISOString().slice(0,10);}
async function loadAttendance(){
  const d=$("att_date"); if(!d.value)d.value=today();
  try{
    const c=encodeURIComponent($("att_class").value||""),g=encodeURIComponent($("att_gender").value||"");
    const data=await api(`/api/attendance?date=${encodeURIComponent(d.value)}&class_level=${c}&gender=${g}`);
    $("attendanceTable").innerHTML=data.map(s=>`<tr><td>${esc(s.reg_no)}</td><td>${esc(s.full_name)}</td><td>${esc(s.class_level)}</td><td>${esc(s.gender)}</td><td><select data-student="${s.id}" class="att-status"><option ${s.status==='Present'?'selected':''}>Present</option><option ${s.status==='Absent'?'selected':''}>Absent</option><option ${s.status==='Late'?'selected':''}>Late</option></select></td></tr>`).join("")||'<tr><td colspan="5">No students found.</td></tr>';
  }catch(e){toast(e.message)}
}
async function saveAttendance(){
  const date=$("att_date").value||today();
  const entries=[...document.querySelectorAll('.att-status')].map(x=>({student_id:x.dataset.student,status:x.value}));
  if(!entries.length){toast('No students to mark');return;}
  try{await api('/api/attendance',{method:'POST',body:JSON.stringify({attendance_date:date,entries})});toast('Attendance saved');await loadAttendance();}
  catch(e){toast(e.message)}
}

async function loadClasses(){
  const data=await api("/api/classes");
  $("classesGrid").innerHTML=data.map(x=>`<div class="card"><span>${esc(x.class_level)}</span><b>${x.total}</b><small>Maza: ${x.male} • Mata: ${x.female}</small></div>`).join("");
}
async function loadFees(){
  const c=encodeURIComponent($("feeClassFilter")?.value||""),g=encodeURIComponent($("feeGenderFilter")?.value||"");
  const data=await api(`/api/fees?class_level=${c}&gender=${g}`);
  $("feesTable").innerHTML=data.map(f=>`<tr><td>${esc(f.payment_date)}</td><td>${esc(f.full_name)}</td><td>${esc(f.reg_no)}</td><td>${esc(f.fee_type)}</td><td>${money(f.amount)}</td><td>${esc(f.receipt_no)}</td><td><button onclick="deleteFee('${f.id}')">Delete</button></td></tr>`).join("")||"<tr><td colspan=7>No payments yet.</td></tr>";
}
$("feeForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/fees",{method:"POST",body:JSON.stringify({
      student_id:$("fee_student").value,amount:$("fee_amount").value,fee_type:$("fee_type").value,
      payment_date:$("fee_date").value,receipt_no:$("fee_receipt").value,note:$("fee_note").value
    })});
    e.target.reset();toast("Payment saved");await loadFees();await loadDashboard();
  }catch(err){toast(err.message)}
});
async function deleteFee(id){if(!confirm("Delete this payment?"))return;await api("/api/fees/"+id,{method:"DELETE"});await loadFees();await loadDashboard();}

async function loadQuran(){
  const data=await api("/api/quran");
  $("quranTable").innerHTML=data.map(q=>`<tr><td>${esc(q.record_date)}</td><td>${esc(q.full_name)}</td><td>${esc(q.reg_no)}</td><td>${esc(q.part_name)}</td><td>${esc(q.status)}</td><td>${esc(q.note)}</td><td><button onclick="deleteQuran('${q.id}')">Delete</button></td></tr>`).join("")||"<tr><td colspan=7>No Qur'an records yet.</td></tr>";
}
$("quranForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/quran",{method:"POST",body:JSON.stringify({
      student_id:$("quran_student").value,part_name:$("quran_part").value,status:$("quran_status").value,
      record_date:$("quran_date").value,note:$("quran_note").value
    })});
    e.target.reset();toast("Qur'an record saved");await loadQuran();await loadDashboard();
  }catch(err){toast(err.message)}
});
async function deleteQuran(id){if(!confirm("Delete this Qur'an record?"))return;await api("/api/quran/"+id,{method:"DELETE"});await loadQuran();await loadDashboard();}

function buildReport(){
  $("reportArea").innerHTML=`<h3>Current student summary</h3><p><strong>${students.length}</strong> student records loaded.</p><p>Use the buttons above to print the student list, export CSV, or download the full backup.</p>`;
}
async function printStudents(){
  const data=await api("/api/students");
  const w=window.open("","_blank");
  w.document.write(`<html><head><title>Student List</title><style>body{font-family:Arial;padding:25px}h2{text-align:center}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:7px;font-size:12px}th{background:#eee}</style></head><body>
  <h2>${esc(settings.school_name)}</h2><p style="text-align:center">${esc(settings.address)} | ${esc(settings.phone)}</p><h3>Student List</h3>
  <table><tr><th>Reg No.</th><th>Name</th><th>Class</th><th>Gender</th><th>Guardian</th><th>Phone</th></tr>
  ${data.map(s=>`<tr><td>${esc(s.reg_no)}</td><td>${esc(s.full_name)}</td><td>${esc(s.class_level)}</td><td>${esc(s.gender)}</td><td>${esc(s.guardian)}</td><td>${esc(s.guardian_phone)}</td></tr>`).join("")}</table>
  <script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
}
$("settingsForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    settings=await api("/api/settings",{method:"PUT",body:JSON.stringify({
      school_name:$("set_school_name").value,address:$("set_address").value,phone:$("set_phone").value
    })});
    $("schoolNameTop").textContent=settings.school_name;toast("School settings saved");
  }catch(err){toast(err.message)}
});
$("passwordForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/password",{method:"PUT",body:JSON.stringify({
      current_password:$("current_password").value,new_password:$("new_password").value
    })});
    e.target.reset();toast("Password changed successfully");
  }catch(err){toast(err.message)}
});

$("att_date").value=new Date().toISOString().slice(0,10);
$("fee_date").value=new Date().toISOString().slice(0,10);
$("quran_date").value=new Date().toISOString().slice(0,10);
init();
