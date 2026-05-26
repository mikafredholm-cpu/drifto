import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

const LS = {
  str: (k, def) => { try { return localStorage.getItem(k) || def; } catch { return def; } },
  setStr: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const STATUS_META = {
  "Ej påbörjad": { color: "bg-gray-200 text-gray-700" },
  "Pågående": { color: "bg-yellow-100 text-yellow-800" },
  "Klar": { color: "bg-green-100 text-green-800" },
  "Arkiverad": { color: "bg-purple-100 text-purple-800" },
};

const now = () => new Date().toLocaleString("sv-SE").slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (t) => t.deadline && t.deadline < today() && t.status !== "Klar" && t.status !== "Arkiverad";

function computeStatus(task) {
  const total = task.checklist.length;
  const done = task.checklist.filter(c => c.done).length;
  if (total > 0 && done === total && task.photo_url) return "Klar";
  if (done > 0 || task.photo_url) return "Pågående";
  return "Ej påbörjad";
}

const normalizeTask = (r) => ({
  ...r,
  checklist: Array.isArray(r.checklist) ? r.checklist : [],
  comments: Array.isArray(r.comments) ? r.comments : [],
});

/* ============================================================
   DATALAGER – alla anrop mot Supabase samlade här
   ============================================================ */
const db = {
  async login(username, password) {
    const { data, error } = await supabase
      .from("users").select("*").eq("username", username).eq("password", password).single();
    if (error || !data) return null;
    return data;
  },
  async getUsers() {
    const { data } = await supabase.from("users").select("*").order("id");
    return data || [];
  },
  async addUser(u) {
    const { data } = await supabase.from("users").insert(u).select().single();
    return data;
  },
  async updateUser(id, vals) {
    await supabase.from("users").update(vals).eq("id", id);
  },
  async deleteUser(id) {
    await supabase.from("users").delete().eq("id", id);
  },
  async getTasks() {
    const { data } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    return (data || []).map(normalizeTask);
  },
  async addTask(t) {
    const { data } = await supabase.from("tasks").insert(t).select().single();
    return normalizeTask(data);
  },
  async updateTask(id, vals) {
    await supabase.from("tasks").update(vals).eq("id", id);
  },
  async deleteTask(id) {
    await supabase.from("tasks").delete().eq("id", id);
  },
  async uploadPhoto(taskId, file) {
    const ext = (file.name || "jpg").split(".").pop();
    const path = `task-${taskId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("task-photos").upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("task-photos").getPublicUrl(path);
    return data.publicUrl;
  },
};

/* ====================== UI-KOMPONENTER ====================== */

function Toast({ toasts }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${t.type === "error" ? "bg-red-500" : "bg-green-600"}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function Confirm({ msg, onYes, onNo }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
        <p className="text-gray-800 mb-5">{msg}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onNo} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Avbryt</button>
          <button onClick={onYes} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Ta bort</button>
        </div>
      </div>
    </div>
  );
}

function Lightbox({ src, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={onClose}>
      <img src={src} className="max-w-full max-h-full object-contain rounded" />
      <button className="absolute top-4 right-4 text-white text-3xl font-bold" onClick={onClose}>×</button>
    </div>
  );
}

function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META["Ej påbörjad"];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.color}`}>{status}</span>;
}

function Modal({ onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-start justify-center overflow-y-auto py-8 px-2" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} mx-auto`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function TaskCard({ task, onClick, showAssignee }) {
  const total = task.checklist.length;
  const done = task.checklist.filter(c => c.done).length;
  const overdue = isOverdue(task);
  return (
    <div onClick={onClick} className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-semibold text-gray-900 text-sm">{task.title}</span>
        <Badge status={task.status} />
      </div>
      <p className="text-xs text-gray-500 mb-1">📍 {task.address}</p>
      {showAssignee && <p className="text-xs text-gray-500 mb-1">👤 {task.assignee_name}</p>}
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
        <span>📅 {task.deadline}</span>
        {overdue && <span className="text-red-600 font-semibold">⚠ Försenad</span>}
        {total > 0 && <span>✅ {done}/{total}</span>}
        {task.comments.length > 0 && <span>💬 {task.comments.length}</span>}
        {task.photo_url && <span>📷</span>}
      </div>
      {task.photo_url && <img src={task.photo_url} className="mt-2 h-16 w-full object-cover rounded-lg" />}
    </div>
  );
}

function TaskModal({ task, currentUser, onClose, onUpdate, onDelete, onArchive, toast }) {
  const [comment, setComment] = useState("");
  const [lightbox, setLightbox] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isAdmin = currentUser.role === "admin";
  const fileRef = useRef();

  const toggleCheck = (id) => {
    if (isAdmin) return;
    const checklist = task.checklist.map(c => c.id === id ? { ...c, done: !c.done } : c);
    const updated = { ...task, checklist };
    updated.status = computeStatus(updated);
    onUpdate(updated, { checklist, status: updated.status });
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await db.uploadPhoto(task.id, file);
      const updated = { ...task, photo_url: url };
      updated.status = computeStatus(updated);
      onUpdate(updated, { photo_url: url, status: updated.status });
      toast("Foto uppladdad");
    } catch {
      toast("Kunde inte ladda upp foto", "error");
    }
    setUploading(false);
  };

  const addComment = () => {
    if (!comment.trim()) return;
    const comments = [...task.comments, { id: Date.now(), author: currentUser.name, text: comment.trim(), time: now() }];
    onUpdate({ ...task, comments }, { comments });
    setComment("");
    toast("Kommentar tillagd");
  };

  return (
    <>
      {lightbox && <Lightbox src={task.photo_url} onClose={() => setLightbox(false)} />}
      {confirmDel && <Confirm msg={`Ta bort uppgiften "${task.title}"?`} onYes={() => { onDelete(task.id); onClose(); }} onNo={() => setConfirmDel(false)} />}
      <Modal onClose={onClose} wide>
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{task.title}</h2>
              <p className="text-sm text-gray-500 mt-0.5">📍 {task.address}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge status={task.status} />
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-1">×</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 mb-4">
            <span>👤 {task.assignee_name}</span>
            <span>📅 {task.deadline}</span>
            {isOverdue(task) && <span className="text-red-600 font-semibold col-span-2">⚠ Försenad</span>}
          </div>

          {task.description && <p className="text-sm text-gray-700 mb-4 p-3 bg-gray-50 rounded-lg">{task.description}</p>}

          {task.checklist.length > 0 && (
            <div className="mb-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-2">Checklista</h3>
              <div className="space-y-1">
                {task.checklist.map(c => (
                  <label key={c.id} className={`flex items-center gap-2 p-2 rounded-lg ${!isAdmin ? "cursor-pointer hover:bg-gray-50" : ""}`}>
                    <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c.id)} disabled={isAdmin} className="w-4 h-4 accent-blue-600" />
                    <span className={`text-sm ${c.done ? "line-through text-gray-400" : "text-gray-700"}`}>{c.text}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">Foto</h3>
            {task.photo_url ? (
              <img src={task.photo_url} onClick={() => setLightbox(true)} className="w-full max-h-48 object-cover rounded-lg cursor-zoom-in" />
            ) : (
              <div className="h-24 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm">Inget foto</div>
            )}
            {!isAdmin && (
              <>
                <button onClick={() => fileRef.current.click()} disabled={uploading} className="mt-2 text-xs text-blue-600 hover:underline disabled:text-gray-400">
                  {uploading ? "Laddar upp..." : task.photo_url ? "Byt foto" : "Ladda upp foto"}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadPhoto} />
              </>
            )}
          </div>

          <div className="mb-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">Kommentarer</h3>
            <div className="space-y-2 max-h-36 overflow-y-auto mb-2">
              {task.comments.length === 0 && <p className="text-xs text-gray-400">Inga kommentarer ännu.</p>}
              {task.comments.map(c => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                    <span className="font-semibold">{c.author}</span>
                    <span>{c.time}</span>
                  </div>
                  <p className="text-sm text-gray-700">{c.text}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === "Enter" && addComment()} placeholder="Lägg till kommentar..." className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={addComment} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700">Skicka</button>
            </div>
          </div>

          {isAdmin && (
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => { onArchive(task.id); onClose(); }} className="flex-1 bg-purple-100 text-purple-700 px-3 py-2 rounded-lg text-sm hover:bg-purple-200">Arkivera</button>
              <button onClick={() => setConfirmDel(true)} className="flex-1 bg-red-100 text-red-700 px-3 py-2 rounded-lg text-sm hover:bg-red-200">Ta bort</button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function NewTaskModal({ users, onClose, onCreate, toast }) {
  const workers = users.filter(u => u.role === "worker");
  const [form, setForm] = useState({ title: "", address: "", description: "", deadline: "", assignee: workers[0]?.username || "" });
  const [checklist, setChecklist] = useState([]);
  const [newItem, setNewItem] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addItem = () => {
    if (!newItem.trim()) return;
    setChecklist(c => [...c, { id: Date.now(), text: newItem.trim(), done: false }]);
    setNewItem("");
  };
  const removeItem = (id) => setChecklist(c => c.filter(x => x.id !== id));

  const submit = () => {
    if (!form.title.trim() || !form.assignee) { toast("Fyll i titel och tilldela en medarbetare", "error"); return; }
    const finalChecklist = newItem.trim()
      ? [...checklist, { id: Date.now(), text: newItem.trim(), done: false }]
      : checklist;
    const worker = users.find(u => u.username === form.assignee);
    onCreate({
      title: form.title, address: form.address, description: form.description,
      assignee: form.assignee, assignee_name: worker?.name || form.assignee,
      deadline: form.deadline || null, checklist: finalChecklist,
      comments: [], photo_url: null, status: "Ej påbörjad", created_at: new Date().toISOString(),
    });
    onClose();
    toast("Uppgift skapad");
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Ny uppgift</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="space-y-3">
          <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Titel *" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.address} onChange={e => set("address", e.target.value)} placeholder="Adress" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="Beskrivning" rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={form.deadline} onChange={e => set("deadline", e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={form.assignee} onChange={e => set("assignee", e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {workers.map(w => <option key={w.id} value={w.username}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Checklista</p>
            {checklist.map(c => (
              <div key={c.id} className="flex items-center gap-2 mb-1">
                <span className="flex-1 text-sm text-gray-700 bg-gray-50 rounded px-2 py-1">{c.text}</span>
                <button onClick={() => removeItem(c.id)} className="text-red-400 hover:text-red-600 text-lg">×</button>
              </div>
            ))}
            <div className="flex gap-2">
              <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} placeholder="Ny punkt..." className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={addItem} className="bg-gray-100 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-200">+</button>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Avbryt</button>
          <button onClick={submit} className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Skapa uppgift</button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsPage({ users, reloadUsers, company, setCompany, toast }) {
  const [name, setName] = useState(company);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [newUser, setNewUser] = useState({ name: "", username: "", password: "", role: "worker" });
  const [confirmDel, setConfirmDel] = useState(null);

  const saveCompany = () => { setCompany(name); LS.setStr("drifto_company", name); toast("Företagsnamn sparat"); };

  const addUser = async () => {
    if (!newUser.name || !newUser.username || !newUser.password) { toast("Fyll i alla fält", "error"); return; }
    if (users.find(u => u.username === newUser.username)) { toast("Användarnamnet finns redan", "error"); return; }
    await db.addUser({ ...newUser, created_at: new Date().toISOString() });
    await reloadUsers();
    setNewUser({ name: "", username: "", password: "", role: "worker" }); setShowAdd(false);
    toast("Användare skapad");
  };

  const saveEdit = async () => {
    await db.updateUser(editUser.id, { name: editUser.name, password: editUser.password });
    const { data: theirTasks } = await supabase.from("tasks").select("id").eq("assignee", editUser.username);
    for (const t of theirTasks || []) {
      await db.updateTask(t.id, { assignee_name: editUser.name });
    }
    await reloadUsers();
    setEditUser(null); toast("Användare uppdaterad");
  };

  const deleteUser = async (id) => {
    await db.deleteUser(id);
    await reloadUsers();
    setConfirmDel(null); toast("Användare borttagen");
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {confirmDel && <Confirm msg="Ta bort användaren?" onYes={() => deleteUser(confirmDel)} onNo={() => setConfirmDel(null)} />}
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Inställningar & Personal</h2>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-semibold text-gray-800 mb-3">Företagsnamn</h3>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={saveCompany} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Spara</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-gray-800">Användare</h3>
          <button onClick={() => setShowAdd(!showAdd)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">+ Ny användare</button>
        </div>

        {showAdd && (
          <div className="bg-blue-50 rounded-lg p-4 mb-4 space-y-2">
            <input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Namn" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} placeholder="Användarnamn" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} placeholder="Lösenord" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="worker">Medarbetare</option>
              <option value="admin">Admin</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm">Avbryt</button>
              <button onClick={addUser} className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">Lägg till</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-lg">
              {editUser?.id === u.id ? (
                <>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input value={editUser.name} onChange={e => setEditUser(eu => ({ ...eu, name: e.target.value }))} className="border border-gray-300 rounded px-2 py-1 text-sm" />
                    <input type="password" value={editUser.password} onChange={e => setEditUser(eu => ({ ...eu, password: e.target.value }))} placeholder="Nytt lösenord" className="border border-gray-300 rounded px-2 py-1 text-sm" />
                  </div>
                  <button onClick={saveEdit} className="text-green-600 text-xs font-semibold hover:underline">Spara</button>
                  <button onClick={() => setEditUser(null)} className="text-gray-400 text-xs hover:underline">Avbryt</button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{u.name}</p>
                    <p className="text-xs text-gray-500">@{u.username} · {u.role === "admin" ? "Admin" : "Medarbetare"}</p>
                  </div>
                  <button onClick={() => setEditUser({ ...u })} className="text-blue-600 text-xs hover:underline">Redigera</button>
                  {u.role !== "admin" && <button onClick={() => setConfirmDel(u.id)} className="text-red-500 text-xs hover:underline">Ta bort</button>}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ tasks, users, onOpenTask, onNewTask }) {
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWorker, setFilterWorker] = useState("all");
  const workers = users.filter(u => u.role === "worker");

  const counts = {
    total: tasks.length,
    "Ej påbörjad": tasks.filter(t => t.status === "Ej påbörjad").length,
    "Pågående": tasks.filter(t => t.status === "Pågående").length,
    "Klar": tasks.filter(t => t.status === "Klar").length,
    "Arkiverad": tasks.filter(t => t.status === "Arkiverad").length,
  };

  const filtered = tasks.filter(t => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterWorker !== "all" && t.assignee !== filterWorker) return false;
    return true;
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-2xl font-bold text-gray-900">Översikt</h2>
        <button onClick={onNewTask} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ Ny uppgift</button>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-5">
        {[["Totalt", counts.total, "bg-slate-100 text-slate-700"], ["Ej påbörjad", counts["Ej påbörjad"], "bg-gray-100 text-gray-700"], ["Pågående", counts["Pågående"], "bg-yellow-50 text-yellow-700"], ["Klar", counts["Klar"], "bg-green-50 text-green-700"], ["Arkiverad", counts["Arkiverad"], "bg-purple-50 text-purple-700"]].map(([label, val, cls]) => (
          <div key={label} className={`rounded-xl p-3 text-center ${cls}`}>
            <div className="text-2xl font-bold">{val}</div>
            <div className="text-xs mt-0.5 leading-tight">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="all">Alla statusar</option>
          {["Ej påbörjad", "Pågående", "Klar", "Arkiverad"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterWorker} onChange={e => setFilterWorker(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="all">Alla medarbetare</option>
          {workers.map(w => <option key={w.id} value={w.username}>{w.name}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-center text-gray-400 py-12">Inga uppgifter hittades.</p>}
        {filtered.map(t => <TaskCard key={t.id} task={t} onClick={() => onOpenTask(t)} showAssignee />)}
      </div>
    </div>
  );
}

function WorkerView({ tasks, currentUser, onOpenTask }) {
  const myTasks = tasks.filter(t => t.assignee === currentUser.username && t.status !== "Arkiverad");
  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-5">Mina uppgifter</h2>
      <div className="space-y-3">
        {myTasks.length === 0 && <p className="text-center text-gray-400 py-12">Inga uppgifter tilldelade.</p>}
        {myTasks.map(t => <TaskCard key={t.id} task={t} onClick={() => onOpenTask(t)} showAssignee={false} />)}
      </div>
    </div>
  );
}

function Login({ company, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const attempt = async (u, p) => {
    setBusy(true); setErr("");
    const user = await db.login(u, p);
    setBusy(false);
    if (user) onLogin(user);
    else setErr("Felaktigt användarnamn eller lösenord.");
  };

  const quickLogins = [
    { u: "admin", p: "admin123", label: "Chef (Admin)" },
    { u: "erik", p: "erik123", label: "Erik" },
    { u: "anna", p: "anna123", label: "Anna" },
    { u: "bjorn", p: "bjorn123", label: "Björn" },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl font-black text-slate-900 tracking-tight">Drifto</div>
          <div className="text-sm text-gray-500 mt-1">{company}</div>
        </div>
        <div className="space-y-3 mb-4">
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Användarnamn" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && attempt(username, password)} placeholder="Lösenord" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {err && <p className="text-red-600 text-xs">{err}</p>}
          <button onClick={() => attempt(username, password)} disabled={busy} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {busy ? "Loggar in..." : "Logga in"}
          </button>
        </div>
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500 mb-2 text-center">Snabbinloggning</p>
          <div className="grid grid-cols-2 gap-2">
            {quickLogins.map(q => (
              <button key={q.u} onClick={() => attempt(q.u, q.p)} disabled={busy} className="border border-gray-200 text-gray-700 rounded-lg py-2 text-xs hover:bg-gray-50 disabled:opacity-60">
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [company, setCompany] = useState(() => LS.str("drifto_company", "Mitt Företag"));
  const [currentUser, setCurrentUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [openTask, setOpenTask] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [toasts, setToasts] = useState([]);

  const toast = (msg, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2500);
  };

  const reloadUsers = useCallback(async () => setUsers(await db.getUsers()), []);
  const reloadTasks = useCallback(async () => setTasks(await db.getTasks()), []);

  useEffect(() => {
    if (!currentUser) return;
    reloadUsers();
    reloadTasks();
    const channel = supabase
      .channel("tasks-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        reloadTasks();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser, reloadUsers, reloadTasks]);

  useEffect(() => {
    if (openTask) {
      const fresh = tasks.find(t => t.id === openTask.id);
      if (fresh && fresh !== openTask) setOpenTask(fresh);
    }
  }, [tasks]); // eslint-disable-line

  const updateTask = async (optimistic, dbVals) => {
    setTasks(ts => ts.map(t => t.id === optimistic.id ? optimistic : t));
    setOpenTask(o => (o && o.id === optimistic.id ? optimistic : o));
    await db.updateTask(optimistic.id, dbVals);
  };
  const createTask = async (t) => {
    const created = await db.addTask(t);
    setTasks(ts => [created, ...ts]);
  };
  const deleteTask = async (id) => {
    setTasks(ts => ts.filter(t => t.id !== id));
    await db.deleteTask(id);
    toast("Uppgift borttagen");
  };
  const archiveTask = async (id) => {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status: "Arkiverad" } : t));
    await db.updateTask(id, { status: "Arkiverad" });
    toast("Uppgift arkiverad");
  };

  if (!currentUser) return <Login company={company} onLogin={u => { setCurrentUser(u); setTab(u.role === "admin" ? "dashboard" : "mytasks"); }} />;

  const isAdmin = currentUser.role === "admin";

  return (
    <div className="min-h-screen bg-slate-50">
      <Toast toasts={toasts} />

      <nav className="bg-slate-900 text-white sticky top-0 z-30 px-4 py-3 flex items-center gap-4">
        <span className="font-black text-lg tracking-tight">Drifto</span>
        <span className="text-slate-400 text-sm hidden sm:inline">· {company}</span>
        <div className="flex-1 flex gap-1 justify-center">
          {isAdmin && (
            <>
              <button onClick={() => setTab("dashboard")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "dashboard" ? "bg-blue-600" : "hover:bg-slate-700"}`}>Översikt</button>
              <button onClick={() => setTab("settings")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "settings" ? "bg-blue-600" : "hover:bg-slate-700"}`}>Personal</button>
            </>
          )}
          {!isAdmin && (
            <button onClick={() => setTab("mytasks")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "mytasks" ? "bg-blue-600" : "hover:bg-slate-700"}`}>Mina uppgifter</button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-300 hidden sm:inline">{currentUser.name}</span>
          <button onClick={() => setCurrentUser(null)} className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1.5 rounded-lg">Logga ut</button>
        </div>
      </nav>

      {tab === "dashboard" && isAdmin && (
        <Dashboard tasks={tasks} users={users} onOpenTask={t => setOpenTask(t)} onNewTask={() => setShowNew(true)} />
      )}
      {tab === "settings" && isAdmin && (
        <SettingsPage users={users} reloadUsers={reloadUsers} company={company} setCompany={setCompany} toast={toast} />
      )}
      {tab === "mytasks" && !isAdmin && (
        <WorkerView tasks={tasks} currentUser={currentUser} onOpenTask={t => setOpenTask(t)} />
      )}

      {openTask && (
        <TaskModal
          task={openTask} currentUser={currentUser}
          onClose={() => setOpenTask(null)}
          onUpdate={updateTask} onDelete={deleteTask} onArchive={archiveTask}
          toast={toast}
        />
      )}
      {showNew && <NewTaskModal users={users} onClose={() => setShowNew(false)} onCreate={createTask} toast={toast} />}
    </div>
  );
}