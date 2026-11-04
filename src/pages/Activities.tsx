import { FormEvent, useEffect, useState } from "react";
import StatusBadge, { activityKind } from "../components/StatusBadge";
import EmptyState from "../components/EmptyState";
import { Link } from "react-router-dom";
import { Pencil, Plus, QrCode, Repeat, Trash2, UserPlus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";
import RecurringActivities from "../components/RecurringActivities";
import ActivityGuests from "../components/ActivityGuests";
import type { Activity as ActivityType } from "../types";
import { TYPE_ORDER } from "../lib/stats";

// Statut automatique : une activité passe en "terminée" 5 h après sa fin
// (ou 5 h après son début si aucune heure de fin n'est renseignée).
const AUTO_CLOSE_HOURS = 4; // sans heure de fin : l'activité se termine 4 h après son début
const PUBLIC_SITE_URL = "https://conseil-ugb-presence.netlify.app";
const closeTime = (start: string, end: string | null) => end ? new Date(end).getTime() : new Date(start).getTime() + AUTO_CLOSE_HOURS * 3600 * 1000;
const effectiveStatus = (a: ActivityType) =>
  a.status === "annulée" ? "annulée"
  : Date.now() >= closeTime(a.start_datetime, a.end_datetime) ? "terminée"
  : Date.now() >= new Date(a.start_datetime).getTime() ? "en cours"
  : "prévue";

export default function Activities({ canDelete = false }: { canDelete?: boolean }) {
  const [items,setItems]=useState<ActivityType[]>([]);
  const [open,setOpen]=useState(false);
  const [qr,setQr]=useState<ActivityType|null>(null);
  const [editId,setEditId]=useState<string|null>(null);
  const [recurOpen,setRecurOpen]=useState(false);
  const [guestsFor,setGuestsFor]=useState<ActivityType|null>(null);
  const [guestCounts,setGuestCounts]=useState<Record<string,number>>({});
  const [tab,setTab]=useState<"all"|"today"|"upcoming"|"past">("all");
  const [types,setTypes]=useState<{id:string;name:string}[]>([]);
  const empty={name:"",location:"",start_datetime:"",end_datetime:"",status:"prévue",cancelled:false,activity_type_id:""};
  const [form,setForm]=useState(empty);
  useEffect(()=>{supabase.from("activity_types").select("id,name").then(({data})=>setTypes(((data||[]) as {id:string;name:string}[]).sort((a,b)=>TYPE_ORDER.indexOf(a.name)-TYPE_ORDER.indexOf(b.name))));},[]);
  const typeName=(id:string|null)=>types.find(t=>t.id===id)?.name||"—";
  // Le QR doit toujours pointer vers le site en ligne : « localhost » ou une adresse du réseau local
  // ne s'ouvre pas sur le téléphone des membres.
  const siteUrl=/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname)?PUBLIC_SITE_URL:window.location.origin;
  const qrLink=(a:ActivityType)=>`${siteUrl}/checkin/${a.qr_token}`;

  async function load(){
    await supabase.rpc("generate_recurring_activities"); // crée les activités récurrentes des 4 prochaines semaines
    await supabase.rpc("refresh_activity_status"); // met à jour les statuts (prévue / en cours / terminée)
    const {data}=await supabase.from("activities").select("*").order("start_datetime",{ascending:false});
    setItems((data as ActivityType[])||[]);
    const {data:g}=await supabase.from("activity_guests").select("activity_id");   // ignoré si la table n'existe pas encore
    const counts:Record<string,number>={};
    ((g||[]) as {activity_id:string}[]).forEach(r=>{counts[r.activity_id]=(counts[r.activity_id]||0)+1;});
    setGuestCounts(counts);
  }
  useEffect(()=>{load()},[]);

  const toLocalInput=(iso:string|null)=>{if(!iso)return "";const d=new Date(iso);const p=(n:number)=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
  function openNew(){setEditId(null);setForm(empty);setOpen(true);}
  function openEdit(a:ActivityType){
    setEditId(a.id);
    setForm({name:a.name,location:a.location||"",start_datetime:toLocalInput(a.start_datetime),end_datetime:toLocalInput(a.end_datetime),status:a.status,cancelled:a.status==="annulée",activity_type_id:a.activity_type_id||""});
    setOpen(true);
  }
  function closeForm(){setOpen(false);setEditId(null);setForm(empty);}
  async function save(e:FormEvent){
    e.preventDefault();
    const status=form.cancelled?"annulée":(form.status==="annulée"?"prévue":form.status);
    const payload={name:form.name.trim(),location:form.location.trim()||null,start_datetime:new Date(form.start_datetime).toISOString(),end_datetime:form.end_datetime?new Date(form.end_datetime).toISOString():null,status,activity_type_id:form.activity_type_id||null};
    if(editId){
      const {data,error}=await supabase.from("activities").update(payload).eq("id",editId).select("id");
      if(error){alert(error.message);return;}
      if(!data||!data.length){alert("Modification refusée : seuls les administrateurs et les responsables peuvent modifier une activité.");return;}
    }else{
      const {error}=await supabase.from("activities").insert(payload);
      if(error){alert(error.message);return;}
    }
    closeForm();load();
  }
  async function remove(id:string){if(confirm("Supprimer cette activité ?")){await supabase.from("activities").delete().eq("id",id);load();}}

  // ----- Activités du jour et filtres -----
  const dayStart=new Date();dayStart.setHours(0,0,0,0);
  const dayEnd=new Date(dayStart.getTime()+24*3600*1000);
  const at=(a:ActivityType)=>new Date(a.start_datetime).getTime();
  const rank=(a:ActivityType)=>effectiveStatus(a)==="en cours"?0:1; // 0 = en cours, toujours en haut
  const todayItems=items.filter(a=>at(a)>=dayStart.getTime()&&at(a)<dayEnd.getTime()).sort((a,b)=>rank(a)-rank(b)||at(a)-at(b));
  const shown=items.filter(a=>tab==="today"?(at(a)>=dayStart.getTime()&&at(a)<dayEnd.getTime()):tab==="upcoming"?at(a)>=dayEnd.getTime():tab==="past"?at(a)<dayStart.getTime():true).sort((a,b)=>rank(a)-rank(b));
  const tabs:[typeof tab,string][]=[["all","Toutes"],["today","Aujourd'hui"],["upcoming","À venir"],["past","Passées"]];

  const limit=form.start_datetime?new Date(closeTime(new Date(form.start_datetime).toISOString(),form.end_datetime?new Date(form.end_datetime).toISOString():null)):null;

  return <><PageHeader title="Activités" description="Créer et gérer les activités de l'organisation." action={<div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="secondary" onClick={()=>setRecurOpen(true)}><Repeat size={18}/> Activités récurrentes</button><button className="primary" onClick={openNew}><Plus size={18}/> Nouvelle activité</button></div>}/>
    <div className="panel">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8,flexWrap:"wrap",marginBottom:10}}>
        <h2 style={{margin:0,fontSize:17}}>Activités du jour</h2>
        <span className="muted" style={{textTransform:"capitalize"}}>{new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</span>
      </div>
      {!todayItems.length&&<EmptyState compact icon="activities" title="Aucune activité aujourd'hui"/>}
      {todayItems.map(a=>{const st=effectiveStatus(a);return <div className="att-row" key={a.id} style={st==="en cours"?{padding:"11px 12px",margin:"0 -12px",background:"#eef8f2",borderRadius:10}:{padding:"11px 0"}}>
        <div style={{display:"flex",gap:14,alignItems:"center",minWidth:0}}>
          <div style={{fontWeight:800,fontSize:18,minWidth:56}}>{new Date(a.start_datetime).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div>
          <div style={{minWidth:0}}><div className="att-name">{a.name}</div><div className="muted" style={{fontSize:13}}>{typeName(a.activity_type_id)}{a.location?` · ${a.location}`:""}</div></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0,flexWrap:"wrap"}}>
          <StatusBadge kind={activityKind(st)}/>
          {st!=="annulée"&&<button type="button" className="secondary" onClick={()=>setQr(a)}><QrCode size={16}/> QR</button>}
          <button type="button" className="secondary" onClick={()=>setGuestsFor(a)}><UserPlus size={16}/> Invités{guestCounts[a.id]?` (${guestCounts[a.id]})`:""}</button>
          {st!=="annulée"&&<Link to="/attendance" className="primary" style={{textDecoration:"none"}}>Faire l'appel</Link>}
        </div>
      </div>;})}
    </div>

    <div className="type-tabs">{tabs.map(([k,l])=><button type="button" key={k} className={`type-tab${tab===k?" on":""}`} onClick={()=>setTab(k)}>{l}</button>)}</div>
    <div className="panel table-wrap"><table><thead><tr><th>Nom</th><th>Type</th><th>Lieu</th><th>Date</th><th>Statut</th><th>Invités</th><th>QR</th><th>Actions</th></tr></thead><tbody>{shown.map(a=><tr key={a.id} style={effectiveStatus(a)==="en cours"?{background:"#eef8f2"}:undefined}><td>{a.name}</td><td><span className="badge">{typeName(a.activity_type_id)}</span></td><td>{a.location||"—"}</td><td>{new Date(a.start_datetime).toLocaleString("fr-FR")}</td><td><span className={`badge${effectiveStatus(a)==="en cours"?" active":""}`}>{effectiveStatus(a)==="en cours"?"● en cours":effectiveStatus(a)}</span></td><td><button type="button" className="secondary" style={{minHeight:34,padding:"5px 12px"}} onClick={()=>setGuestsFor(a)}><UserPlus size={15}/> Invités{guestCounts[a.id]?` (${guestCounts[a.id]})`:""}</button></td><td><button className="icon-btn" title="Afficher le QR code" onClick={()=>setQr(a)}><QrCode size={17}/></button></td><td><button className="icon-btn" title="Modifier" onClick={()=>openEdit(a)}><Pencil size={17}/></button>{canDelete&&<button className="icon-btn danger" title="Supprimer" onClick={()=>remove(a.id)}><Trash2 size={17}/></button>}</td></tr>)}</tbody></table>{!shown.length&&<EmptyState icon="activities" title="Aucune activité" hint="Crée la première activité pour pouvoir faire l'appel." actions={[{label:"Créer une activité",onClick:openNew}]}/>}</div>
    {open&&<div className="modal-backdrop"><form className="modal" onSubmit={save}><div className="modal-head"><h2>{editId?"Modifier l'activité":"Nouvelle activité"}</h2><button type="button" className="icon-btn" onClick={closeForm}>×</button></div>
      <div className="form-grid"><label>Type d'activité<select required value={form.activity_type_id} onChange={e=>{const id=e.target.value;setForm({...form,activity_type_id:id,name:form.name||types.find(t=>t.id===id)?.name||""})}}><option value="">— Choisir —</option>{types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Nom<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Lieu<input value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></label><label>Date/heure de début<input required type="datetime-local" value={form.start_datetime} onChange={e=>setForm({...form,start_datetime:e.target.value})}/></label><label>Date/heure de fin<input type="datetime-local" value={form.end_datetime} onChange={e=>setForm({...form,end_datetime:e.target.value})}/></label>{editId&&<label style={{display:"flex",alignItems:"center",gap:8}}><input type="checkbox" style={{width:"auto"}} checked={form.cancelled} onChange={e=>setForm({...form,cancelled:e.target.checked})}/> Activité annulée</label>}</div>
      <p className="muted" style={{margin:"12px 0 0"}}>Le statut est automatique (prévue, en cours, terminée).{limit&&!isNaN(limit.getTime())?` Cette activité passera en « terminée » le ${limit.toLocaleString("fr-FR",{dateStyle:"medium",timeStyle:"short"})}, ${AUTO_CLOSE_HOURS} h après sa fin (ou après son début si aucune fin n'est indiquée).`:""}</p>
      <div className="modal-actions"><button type="button" className="secondary" onClick={closeForm}>Annuler</button><button className="primary">{editId?"Enregistrer les modifications":"Enregistrer"}</button></div>
    </form></div>}
    {qr&&<div className="modal-backdrop" onClick={()=>setQr(null)}><div className="modal" style={{textAlign:"center",width:"min(420px,100%)"}} onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>{qr.name}</h2><button type="button" className="icon-btn" onClick={()=>setQr(null)}>×</button></div><div style={{background:"#fff",padding:16,display:"inline-block",borderRadius:12,border:"1px solid #e6e8ec"}}><QRCodeSVG value={qrLink(qr)} size={260} level="M"/></div><p className="muted">Les membres scannent ce code pour se marquer présents, de 30 minutes avant le début jusqu'à la fin de l'activité (statut « terminée »).</p><p style={{fontSize:12,wordBreak:"break-all",color:"#667085",margin:"0 0 12px"}}>{qrLink(qr)}</p><button type="button" className="secondary full" onClick={()=>navigator.clipboard.writeText(qrLink(qr)).then(()=>alert("Lien copié"))}>Copier le lien</button></div></div>}
    {guestsFor&&<ActivityGuests activity={guestsFor} onClose={()=>setGuestsFor(null)} onChanged={load}/>}
    {recurOpen&&<RecurringActivities types={types} onClose={()=>setRecurOpen(false)} onChanged={load}/>}
  </>;
}