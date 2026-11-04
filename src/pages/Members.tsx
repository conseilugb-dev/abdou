import { FormEvent, useEffect, useMemo, useState } from "react";
import StatusBadge from "../components/StatusBadge";
import Avatar from "../components/Avatar";
import EmptyState from "../components/EmptyState";
import MemberCardView from "../components/MemberCardView";
import { Download, MessageCircle, Phone, Plus, QrCode, Search, Trash2, UserCheck, UserRoundPen, UserX, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";
import type { Member } from "../types";
import { fmtDate, GOUDI, loadStats, type StatsData } from "../lib/stats";
import { siteUrl } from "../lib/site";

export default function Members() {
  const [members,setMembers]=useState<Member[]>([]);
  const [q,setQ]=useState("");
  type SortKey="last_name"|"first_name"|"member_number"|"created_at";
  const [sortKey,setSortKey]=useState<SortKey>("last_name");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");
  const [fSection,setFSection]=useState("");
  const [fLevel,setFLevel]=useState("");
  const [fField,setFField]=useState("");
  const [view,setView]=useState<"active"|"inactive"|"all">("active");
  const [open,setOpen]=useState(false);
  // Champs demandés pour chaque membre. "locality" = Adresse, "function_name" = Fonction dans la section.
  type FieldDef={key:string;label:string;required?:boolean;type?:string;options?:string[]};
  const FIELD_DEFS:FieldDef[]=[
    {key:"first_name",label:"Prénom",required:true},
    {key:"last_name",label:"Nom",required:true},
    {key:"email",label:"Email",required:true,type:"email"},
    {key:"phone",label:"Téléphone",required:true,type:"tel"},
    {key:"locality",label:"Adresse",required:true},
    {key:"study_field",label:"Filière"},
    {key:"study_level",label:"Niveau d’étude",options:["L1","L2","L3","M1","M2","Doctorat","Autre"]},
    {key:"section_id",label:"Section"},
    {key:"function_name",label:"Fonction dans la section"},
    {key:"join_year",label:"Année d’adhésion",type:"number"},
    {key:"guardian_phone",label:"Numéro du tuteur",type:"tel"},
    {key:"blood_group",label:"Groupe sanguin",options:["A+","A-","B+","B-","AB+","AB-","O+","O-"]},
  ];
  const [sections,setSections]=useState<{id:string;name:string}[]>([]);
  useEffect(()=>{supabase.from("sections").select("id,name").eq("is_active",true).order("name").then(({data})=>setSections((data||[]) as {id:string;name:string}[]));},[]);
  const sectionName=(id:string|null)=>sections.find(x=>x.id===id)?.name||null;
  const blankForm=():Record<string,string>=>({...Object.fromEntries(FIELD_DEFS.map(f=>[f.key,""])),status:"active"});
  const [form,setForm]=useState<Record<string,string>>(blankForm());
  const [photoFile,setPhotoFile]=useState<File|null>(null);
  const [photoErr,setPhotoErr]=useState("");
  const pickPhoto=(f:File|undefined)=>{
    setPhotoErr("");
    if(!f){setPhotoFile(null);return;}
    if(!f.type.startsWith("image/")){setPhotoErr("Choisis une image (JPG, PNG…).");return;}
    if(f.size>3*1024*1024){setPhotoErr("Photo trop lourde (3 Mo maximum).");return;}
    setPhotoFile(f);
  };
  async function uploadPhoto(f:File):Promise<string|null>{
    const ext=(f.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
    const path=`${crypto.randomUUID()}.${ext||"jpg"}`;
    const {error}=await supabase.storage.from("member-photos").upload(path,f,{contentType:f.type});
    if(error){alert("Photo non enregistrée : "+error.message+"\n(Lance supabase/member_fields.sql dans Supabase.)");return null;}
    return supabase.storage.from("member-photos").getPublicUrl(path).data.publicUrl;
  }
  const PhotoField=({current}:{current?:string|null})=><label>Photo
    <input type="file" accept="image/*" onChange={e=>pickPhoto(e.target.files?.[0])}/>
    {photoFile?<span className="muted" style={{fontSize:12}}>{photoFile.name}</span>:current?<img src={current} alt="" style={{width:56,height:56,borderRadius:"50%",objectFit:"cover",marginTop:6}}/>:null}
    {photoErr&&<span style={{color:"#b42318",fontSize:12}}>{photoErr}</span>}
  </label>;
  const renderField=(f:FieldDef,values:Record<string,string>,set:(v:Record<string,string>)=>void)=>
    <label key={f.key}>{f.label}{f.required?" *":""}
      {f.key==="section_id"
        ?<select value={values[f.key]??""} onChange={e=>set({...values,[f.key]:e.target.value})}><option value="">—</option>{sections.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
        :f.options
        ?<select required={f.required} value={values[f.key]??""} onChange={e=>set({...values,[f.key]:e.target.value})}><option value="">—</option>{f.options.map(o=><option key={o} value={o}>{o}</option>)}</select>
        :<input required={f.required} type={f.type||"text"} {...(f.type==="number"?{min:1990,max:2100}:{})} value={values[f.key]??""} onChange={e=>set({...values,[f.key]:e.target.value})}/>}
    </label>;
  const toPayload=(v:Record<string,string>)=>{
    const n=(x:string)=>(x??"").trim()||null;
    return {
      first_name:v.first_name.trim(),last_name:v.last_name.trim(),email:n(v.email),phone:n(v.phone),locality:n(v.locality),
      study_field:n(v.study_field),study_level:n(v.study_level),section_id:n(v.section_id),function_name:n(v.function_name),
      join_year:v.join_year?Number(v.join_year):null,guardian_phone:n(v.guardian_phone),blood_group:n(v.blood_group),
    };
  };

  // ----- Fiche détaillée d'un membre -----
  type Own={status:string;check_in_at:string|null;method:string};
  const [detail,setDetail]=useState<Member|null>(null);
  const [stats,setStats]=useState<StatsData|null>(null);
  const [statsErr,setStatsErr]=useState(false);
  const [own,setOwn]=useState<Record<string,Own>|null>(null);
  const [editing,setEditing]=useState(false);
  const [cardOpen,setCardOpen]=useState(false);
  const [edit,setEdit]=useState<Record<string,string>>({...blankForm(),gender:"",birth_date:"",notes:""});
  useEffect(()=>{loadStats().then(setStats).catch(()=>setStatsErr(true));},[]);

  async function openDetail(m:Member){
    setDetail(m);setOwn(null);setEditing(false);setPhotoFile(null);setPhotoErr("");
    const {data}=await supabase.from("attendance").select("activity_id,status,check_in_at,method").eq("member_id",m.id);
    const map:Record<string,Own>={};
    ((data||[]) as (Own&{activity_id:string})[]).forEach(r=>{map[r.activity_id]=r;});
    setOwn(map);
  }

  function startEdit(m:Member){
    const x=m as unknown as Record<string,unknown>;
    const v=blankForm();
    FIELD_DEFS.forEach(f=>{v[f.key]=x[f.key]==null?"":String(x[f.key]);});
    setEdit({...v,gender:m.gender||"",birth_date:m.birth_date||"",status:m.status,notes:m.notes||""});
    setPhotoFile(null);setPhotoErr("");setEditing(true);
  }
  async function saveEdit(e:FormEvent){
    e.preventDefault();
    if(!detail)return;
    const n=(v:string)=>v.trim()||null;
    const payload:Record<string,unknown>={...toPayload(edit),gender:n(edit.gender),birth_date:edit.birth_date||null,status:edit.status,notes:n(edit.notes)};
    if(photoFile){const url=await uploadPhoto(photoFile);if(!url)return;payload.photo_url=url;}
    const {data,error}=await supabase.from("members").update(payload).eq("id",detail.id).select();
    if(error){alert("Impossible de modifier le membre : "+error.message);return;}
    if(!data||!data.length){alert("Modification refusée : seuls les administrateurs et les responsables peuvent modifier un membre.");return;}
    setDetail(data[0] as Member);setEditing(false);setPhotoFile(null);load();
  }

  const tokenOf=(m:Member)=>(m as Member&{qr_token?:string|null}).qr_token||null;
  async function regenerateCard(m:Member){
    if(!confirm(`Générer une nouvelle carte pour ${m.first_name} ${m.last_name} ?\n\nL'ancien QR code et l'ancien lien ne fonctionneront plus.`))return;
    const {data,error}=await supabase.rpc("regenerate_member_card",{p_member_id:m.id});
    if(error){alert("Impossible de régénérer la carte : "+error.message);return;}
    setDetail({...m,qr_token:data as string} as Member);
    load();
  }

  const history=useMemo(()=>{
    if(!detail||!stats||!own)return null;
    const list=stats.acts.filter(a=>a.marked).sort((a,b)=>b.start.localeCompare(a.start))
      .map(a=>({id:a.id,name:a.name,start:a.start,typeName:a.typeName,status:own[a.id]?.status==="Présent"?"Présent":"Absent"}));
    const present=list.filter(x=>x.status==="Présent").length;
    let streak=0;
    for(const x of list){if(x.typeName!==GOUDI)continue;if(x.status!=="Présent")streak++;else break;}
    return {list,present,absent:list.length-present,rate:list.length?Math.round(present/list.length*100):0,streak};
  },[detail,stats,own]);

  const ext=(m:Member,k:string)=>{const v=(m as unknown as Record<string,unknown>)[k];return v==null||v===""?null:String(v);};
  const ageOf=(d:string|null)=>{if(!d)return null;const b=new Date(d),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))a--;return a>=0&&a<120?a:null;};
  const waLink=(p:string)=>{const d=p.replace(/\D/g,"");return `https://wa.me/${d.length===9?"221"+d:d}`;};
  const rateColor=(r:number)=>r>=70?"#18794e":r>=40?"#b54708":"#b42318";
  const stColor:Record<string,string>={"Présent":"#18794e","Absent":"#b42318"};
  const linkBtn={display:"inline-flex",alignItems:"center",gap:6,padding:"9px 14px",border:"1px solid #d7dce3",borderRadius:10,color:"#172033",textDecoration:"none",fontWeight:600,fontSize:14,background:"#fff"} as const;

  async function load() {
    const {data}=await supabase.from("members").select("*").order("created_at",{ascending:false});
    setMembers((data as Member[])||[]);
  }
  useEffect(()=>{load()},[]);

  async function add(e:FormEvent){
    e.preventDefault();
    const payload:Record<string,unknown>={...toPayload(form),status:"active"};
    if(photoFile){const url=await uploadPhoto(photoFile);if(!url)return;payload.photo_url=url;}
    const {error}=await supabase.from("members").insert(payload);
    if(error){alert("Impossible d'enregistrer le membre : "+error.message);return;}
    setForm(blankForm());setPhotoFile(null);setPhotoErr("");
    setOpen(false); load();
  }
  async function setStatus(m:Member,status:"active"|"inactive"){
    const msg=status==="inactive"
      ?`Masquer ${m.first_name} ${m.last_name} ?\n\nCe membre ne sera plus compté dans les statistiques, les relances et les listes de présence. Son historique est conservé et vous pourrez le réactiver à tout moment.`
      :`Réactiver ${m.first_name} ${m.last_name} ?\n\nIl sera de nouveau compté dans les statistiques et les listes de présence.`;
    if(!confirm(msg))return;
    const {data,error}=await supabase.from("members").update({status}).eq("id",m.id).select();
    if(error){alert("Impossible de modifier le statut : "+error.message);return;}
    if(!data||!data.length){alert("Modification refusée : seuls les administrateurs et les responsables peuvent modifier un membre.");return;}
    if(detail&&detail.id===m.id)setDetail(data[0] as Member);
    load();
    loadStats().then(setStats).catch(()=>setStatsErr(true));
  }
  async function remove(id:string){
    if(!confirm("Supprimer ce membre ?")) return;
    await supabase.from("members").delete().eq("id",id); load();
  }

  // ----- Import Excel / CSV -----
  type Imp={first_name:string;last_name:string;email:string|null;phone:string|null;gender:string|null;birth_date:string|null;locality:string|null;function_name:string|null;study_field:string|null;study_level:string|null;section_id:string|null;join_year:number|null;guardian_phone:string|null;blood_group:string|null};
  const [imp,setImp]=useState<{rows:Imp[];dup:number;bad:number;homonyms:number;review:Imp[]}|null>(null);
  const [includeReview,setIncludeReview]=useState(false);
  const [impOpen,setImpOpen]=useState(false);
  const [impMsg,setImpMsg]=useState("");
  const norm=(v:unknown)=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z]/g,"");
  const FIELDS:Record<string,string[]>={first_name:["prenom","firstname","prenoms"],last_name:["nom","lastname","nomdefamille"],email:["email","mail","courriel"],phone:["telephone","tel","phone","numero","portable"],gender:["sexe","genre","gender"],birth_date:["datenaissance","naissance","birthdate","datedenaissance"],locality:["localite","adresse","ville","quartier"],function_name:["fonction","poste","role","fonctiondanslasection"],study_field:["filiere"],study_level:["niveaudetude","niveau","etude"],section_id:["sectiondebase","section"],join_year:["anneedadhesion","anneeadhesion","adhesion"],guardian_phone:["numerodututeur","tuteur","telephonedututeur"],blood_group:["groupesanguin","groupe","sang"]};
  const toDate=(v:unknown)=>{if(!v)return null;if(v instanceof Date&&!isNaN(+v))return new Date(v.getTime()-v.getTimezoneOffset()*60000).toISOString().slice(0,10);const t=String(v).trim();const m=t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);if(m)return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;return /^\d{4}-\d{2}-\d{2}$/.test(t)?t:null;};
  async function readFile(f:File){
    setImpMsg("");setImp(null);
    try{
      const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});
      const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:""});
      // Téléphone normalisé : chiffres seulement, indicatif +221 / 00221 ignoré (on garde les 9 derniers chiffres)
      const phoneKey=(p:unknown)=>{let d=String(p??"").replace(/\D/g,"");if(d.startsWith("00"))d=d.slice(2);if(d.length>9)d=d.slice(-9);return d.length>=7?d:null;};
      // Pour chaque « prénom|nom » déjà connu : la liste des téléphones des membres qui le portent
      const byName=new Map<string,(string|null)[]>();
      members.forEach(m=>{const k=`${norm(m.first_name)}|${norm(m.last_name)}`;byName.set(k,[...(byName.get(k)||[]),phoneKey(m.phone)]);});
      const rows:Imp[]=[],review:Imp[]=[];let dup=0,bad=0,homonyms=0;
      raw.forEach(r=>{
        const g=(k:string)=>{const key=Object.keys(r).find(c=>FIELDS[k].includes(norm(c)));return key?r[key]:"";};
        const first=String(g("first_name")).trim(),last=String(g("last_name")).trim();
        if(!first||!last){bad++;return;}
        const t=(k:string)=>String(g(k)).trim()||null;
        const row:Imp={first_name:first,last_name:last,email:t("email"),phone:t("phone"),gender:t("gender"),birth_date:toDate(g("birth_date")),locality:t("locality"),function_name:t("function_name"),study_field:t("study_field"),study_level:t("study_level"),section_id:(()=>{const nm=norm(g("section_id"));return nm?(sections.find(x=>norm(x.name)===nm)?.id||null):null;})(),join_year:(()=>{const y=parseInt(String(g("join_year")),10);return isNaN(y)?null:y;})(),guardian_phone:t("guardian_phone"),blood_group:t("blood_group")};
        const id=`${norm(first)}|${norm(last)}`;
        const mine=phoneKey(row.phone);
        const known=byName.get(id);
        if(known){
          if(mine&&known.includes(mine)){dup++;return;}          // même nom + même téléphone : déjà enregistré
          if(mine&&known.every(k=>k!==null))homonyms++;           // même nom, téléphone différent : une autre personne
          else{review.push(row);return;}                          // téléphone manquant : impossible de trancher
        }
        byName.set(id,[...(known||[]),mine]);
        rows.push(row);
      });
      setIncludeReview(false);
      setImp({rows,dup,bad,homonyms,review});
    }catch{setImpMsg("Fichier illisible. Utilise un fichier .xlsx, .xls ou .csv.");}
  }
  async function confirmImport(){
    if(!imp)return;
    const toAdd=[...imp.rows,...(includeReview?imp.review:[])];
    if(!toAdd.length)return;
    for(let i=0;i<toAdd.length;i+=200){
      const {error}=await supabase.from("members").insert(toAdd.slice(i,i+200).map(r=>({...r,status:"active"})));
      if(error){setImpMsg("Erreur : "+error.message);return;}
    }
    setImpMsg(`${toAdd.length} membre(s) ajouté(s).`);setImp(null);setIncludeReview(false);load();
  }
  function template(){
    const ws=XLSX.utils.aoa_to_sheet([["Prénom","Nom","Email","Téléphone","Adresse","Filière","Niveau d’étude","Section","Fonction dans la section","Année d’adhésion","Numéro du tuteur","Groupe sanguin"],["Awa","Fall","awa@example.com","770000000","Saint-Louis","Informatique","L2","Section A","Membre",2025,"780000000","O+"]]);
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Membres");XLSX.writeFile(wb,"modele-import-membres.xlsx");
  }

  const counts={active:members.filter(m=>m.status==="active").length,inactive:members.filter(m=>m.status==="inactive").length};
  const collator=new Intl.Collator("fr",{sensitivity:"base",numeric:true});
  const sortValue=(m:Member)=>sortKey==="last_name"?`${m.last_name} ${m.first_name}`:sortKey==="first_name"?`${m.first_name} ${m.last_name}`:sortKey==="member_number"?(m.member_number||""):(m.created_at||"");
  const sortBy=(k:SortKey)=>{if(sortKey===k)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortKey(k);setSortDir("asc");}};
  const arrow=(k:SortKey)=>sortKey===k?(sortDir==="asc"?" ▲":" ▼"):"";
  const thSort={cursor:"pointer",userSelect:"none"} as const;
  const fields=[...new Set(members.map(m=>(m.study_field||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
  const filtered=members.filter(m=>(view==="all"||m.status===view)&&(!fSection||(fSection==="__none"?!m.section_id:m.section_id===fSection))&&(!fLevel||m.study_level===fLevel)&&(!fField||(m.study_field||"").trim()===fField)&&`${m.first_name} ${m.last_name} ${m.phone||""} ${m.email||""}`.toLowerCase().includes(q.toLowerCase()));
  const sorted=[...filtered].sort((a,b)=>{const r=collator.compare(sortValue(a),sortValue(b));return sortDir==="asc"?r:-r;});

  function exportExcel(){
    const rows=sorted.map(m=>({
      "N° membre":m.member_number,"Prénom":m.first_name,"Nom":m.last_name,"Email":m.email||"","Téléphone":m.phone||"","Adresse":m.locality||"",
      "Filière":m.study_field||"","Niveau d’étude":m.study_level||"","Section":sectionName(m.section_id)||"","Fonction dans la section":m.function_name||"",
      "Année d’adhésion":m.join_year??"","Numéro du tuteur":m.guardian_phone||"","Groupe sanguin":m.blood_group||"",
      "Sexe":m.gender||"","Date de naissance":m.birth_date||"","Statut":m.status==="active"?"Actif":"Ancien membre","Photo (lien)":m.photo_url||"","Notes":m.notes||"","Créé le":(m.created_at||"").slice(0,10),
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    ws["!cols"]=Object.keys(rows[0]||{}).map(k=>({wch:Math.max(12,k.length+2)}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Membres");
    XLSX.writeFile(wb,`membres-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return <><PageHeader title="Membres" description={`${counts.active} membre(s) actif(s)${counts.inactive?` · ${counts.inactive} ancien(s) membre(s) masqué(s)`:""}.`} action={<div className="att-actions"><button className="secondary" disabled={!sorted.length} onClick={exportExcel}><Download size={18}/> Exporter</button><button className="secondary" onClick={()=>{setImpOpen(true);setImp(null);setImpMsg("");}}><Upload size={18}/> Importer</button><button className="primary" onClick={()=>setOpen(true)}><Plus size={18}/> Ajouter un membre</button></div>}/>
    <div className="toolbar"><div className="input-icon search"><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher…"/></div>
      <select aria-label="Trier les membres" value={`${sortKey}:${sortDir}`} onChange={e=>{const [k,d]=e.target.value.split(":");setSortKey(k as SortKey);setSortDir(d as "asc"|"desc");}}>
        <option value="last_name:asc">Trier : Nom (A → Z)</option>
        <option value="last_name:desc">Trier : Nom (Z → A)</option>
        <option value="first_name:asc">Trier : Prénom (A → Z)</option>
        <option value="first_name:desc">Trier : Prénom (Z → A)</option>
        <option value="member_number:asc">Trier : N° de membre</option>
        <option value="created_at:desc">Trier : Plus récents d'abord</option>
      </select>
      <select aria-label="Filtrer par section" value={fSection} onChange={e=>setFSection(e.target.value)}><option value="">Toutes les sections</option>{sections.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}<option value="__none">Sans section</option></select>
      <select aria-label="Filtrer par niveau" value={fLevel} onChange={e=>setFLevel(e.target.value)}><option value="">Tous les niveaux</option>{["L1","L2","L3","M1","M2","Doctorat","Autre"].map(l=><option key={l} value={l}>{l}</option>)}</select>
      <select aria-label="Filtrer par filière" value={fField} onChange={e=>setFField(e.target.value)}><option value="">Toutes les filières</option>{fields.map(f=><option key={f} value={f}>{f}</option>)}</select>
      {(fSection||fLevel||fField)&&<button type="button" className="secondary" onClick={()=>{setFSection("");setFLevel("");setFField("");}}>Effacer les filtres</button>}
      </div>
    <div className="type-tabs">{([["active",`Membres actifs (${counts.active})`],["inactive",`Anciens membres (${counts.inactive})`],["all","Tous"]] as ["active"|"inactive"|"all",string][]).map(([k,l])=><button type="button" key={k} className={`type-tab${view===k?" on":""}`} onClick={()=>setView(k)}>{l}</button>)}</div>
    <div className="panel table-wrap"><table><thead><tr><th style={thSort} onClick={()=>sortBy("first_name")}>Prénom{arrow("first_name")}</th><th style={thSort} onClick={()=>sortBy("last_name")}>Nom{arrow("last_name")}</th><th>Téléphone</th><th>Statut</th><th>Actions et carte</th></tr></thead>
    <tbody>{sorted.map(m=><tr key={m.id} onClick={()=>openDetail(m)} style={{cursor:"pointer",opacity:m.status==="inactive"?.6:1}} title="Voir la fiche du membre"><td><span style={{display:"inline-flex",alignItems:"center",gap:10}}><Avatar first={m.first_name} last={m.last_name} photoUrl={m.photo_url}/>{m.first_name}</span></td><td>{m.last_name}</td><td>{m.phone||"—"}</td><td><StatusBadge kind={m.status==="active"?"member":"former"}/></td><td><button className="icon-btn" title="Carte de membre (QR)" onClick={e=>{e.stopPropagation();openDetail(m);setCardOpen(true);}}><QrCode size={17}/></button><button className="icon-btn" title="Voir la fiche" onClick={e=>{e.stopPropagation();openDetail(m);}}><UserRoundPen size={17}/></button><button className="icon-btn" title={m.status==="active"?"Masquer (ancien membre)":"Réactiver"} onClick={e=>{e.stopPropagation();setStatus(m,m.status==="active"?"inactive":"active");}}>{m.status==="active"?<UserX size={17}/>:<UserCheck size={17}/>}</button><button className="icon-btn danger" title="Supprimer" onClick={e=>{e.stopPropagation();remove(m.id);}}><Trash2 size={17}/></button></td></tr>)}</tbody></table>{!filtered.length&&<EmptyState icon={q?"search":"members"} title={view==="inactive"&&!q?"Aucun ancien membre masqué":q?"Aucun membre trouvé":"Aucun membre pour le moment"} hint={q?"Essaie un autre nom ou numéro.":view==="inactive"?undefined:"Ajoute le premier membre ou importe un fichier Excel."} actions={q?[{label:"Effacer la recherche",onClick:()=>setQ(""),variant:"secondary"}]:view==="inactive"?undefined:[{label:"Ajouter un membre",onClick:()=>setOpen(true)},{label:"Importer un fichier",onClick:()=>{setImpOpen(true);setImp(null);setImpMsg("");},variant:"secondary"}]}/>}</div>
    {open&&<div className="modal-backdrop"><form className="modal" onSubmit={add}><div className="modal-head"><h2>Nouveau membre</h2><button type="button" className="icon-btn" onClick={()=>setOpen(false)}>×</button></div>
      <div className="form-grid">{FIELD_DEFS.map(f=>renderField(f,form,setForm))}<PhotoField/></div>
      <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Annuler</button><button className="primary">Enregistrer</button></div>
    </form></div>}
    {impOpen&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>Importer des membres</h2><button type="button" className="icon-btn" onClick={()=>setImpOpen(false)}>×</button></div>
      <div className="import-box"><p style={{marginTop:0}}>Fichier Excel (.xlsx, .xls) ou CSV avec les colonnes : <b>Prénom, Nom</b> (obligatoires), Email, Téléphone, Adresse, Filière, Niveau d’étude, Section, Fonction dans la section, Année d’adhésion, Numéro du tuteur, Groupe sanguin. Si deux personnes ont le même prénom et le même nom, le <b>numéro de téléphone</b> sert à les différencier.</p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const f=e.target.files?.[0];if(f)readFile(f);}}/>
      <p style={{marginBottom:0}}><button type="button" className="secondary" onClick={template}>Télécharger le modèle</button></p></div>
      {imp&&<div className="success-box"><b>{imp.rows.length}</b> membre(s) à ajouter{imp.homonyms>0&&<> (dont <b>{imp.homonyms}</b> homonyme(s) différencié(s) par le téléphone)</>} · {imp.dup} doublon(s) ignoré(s) (même nom et même téléphone) · {imp.bad} ligne(s) sans nom/prénom ignorée(s)</div>}
      {imp&&imp.review.length>0&&<div className="error-box" style={{background:"#fff8e6",borderColor:"#f5d78a",color:"#8a5a00",marginTop:12}}>
        <b>{imp.review.length} homonyme(s) à vérifier</b> : même prénom et nom qu'un membre déjà enregistré, mais un téléphone manque pour savoir si c'est la même personne. Ils ne sont pas ajoutés par défaut.
        <ul style={{margin:"8px 0",paddingLeft:18}}>{imp.review.slice(0,8).map((r,i)=><li key={i}>{r.last_name} {r.first_name} — {r.phone||"pas de numéro"}</li>)}{imp.review.length>8&&<li>… et {imp.review.length-8} autre(s)</li>}</ul>
        <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:700,color:"inherit"}}><input type="checkbox" checked={includeReview} onChange={e=>setIncludeReview(e.target.checked)} style={{width:18,height:18,padding:0}}/> Ajouter aussi ces {imp.review.length} membre(s)</label>
      </div>}
      {impMsg&&<div className={impMsg.startsWith("Erreur")||impMsg.startsWith("Fichier")?"error-box":"success-box"}>{impMsg}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setImpOpen(false)}>Fermer</button><button type="button" className="primary" disabled={!imp||!(imp.rows.length+(includeReview?imp.review.length:0))} onClick={confirmImport}>Ajouter {imp?imp.rows.length+(includeReview?imp.review.length:0):0} membre(s)</button></div>
    </div></div>}
    {detail&&<div className="modal-backdrop" onClick={()=>setDetail(null)}><div className="modal" style={{width:"min(760px,100%)",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      <div className="modal-head"><div style={{display:"flex",alignItems:"center",gap:12}}><Avatar first={detail.first_name} last={detail.last_name} size={48} photoUrl={detail.photo_url}/><div><h2 style={{margin:0}}>{detail.first_name} {detail.last_name}</h2><div style={{marginTop:6,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span className="muted">N° {detail.member_number}</span><StatusBadge kind={detail.status==="active"?"member":"former"}/></div></div></div><button type="button" className="icon-btn" onClick={()=>setDetail(null)}>×</button></div>

      {detail.status==="inactive"&&<div className="error-box" style={{marginBottom:14,background:"#fff8e6",borderColor:"#f5d78a",color:"#8a5a00"}}>Ancien membre : masqué, non compté dans les statistiques, les relances ni les listes de présence. Son historique est conservé.</div>}
      {editing?(<form onSubmit={saveEdit}>
        <div className="form-grid">{FIELD_DEFS.map(f=>renderField(f,edit,setEdit))}
          <label>Sexe (M ou F)<input value={edit.gender} onChange={e=>setEdit({...edit,gender:e.target.value})}/></label>
          <label>Date de naissance<input type="date" value={edit.birth_date} onChange={e=>setEdit({...edit,birth_date:e.target.value})}/></label>
          <PhotoField current={detail.photo_url}/>
          <label>Statut<select value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})}><option value="active">Actif</option><option value="inactive">Ancien membre (masqué)</option></select></label>
          <label>Notes<textarea rows={3} value={edit.notes} onChange={e=>setEdit({...edit,notes:e.target.value})}/></label>
        </div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setEditing(false)}>Annuler</button><button className="primary">Enregistrer les modifications</button></div>
      </form>):(<>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14}}>{([
        ["Prénom",detail.first_name],
        ["Nom",detail.last_name],
        ["E-mail",detail.email],
        ["Téléphone",detail.phone],
        ["Adresse",detail.locality],
        ["Filière",ext(detail,"study_field")],
        ["Niveau d’étude",ext(detail,"study_level")],
        ["Section",sectionName(detail.section_id)],
        ["Fonction dans la section",detail.function_name],
        ["Année d’adhésion",ext(detail,"join_year")],
        ["Numéro du tuteur",ext(detail,"guardian_phone")],
        ["Groupe sanguin",ext(detail,"blood_group")],
        ["Sexe",detail.gender==="F"?"Féminin":detail.gender==="M"?"Masculin":detail.gender],
        ["Date de naissance",detail.birth_date?`${fmtDate(detail.birth_date)}${ageOf(detail.birth_date)!==null?` (${ageOf(detail.birth_date)} ans)`:""}`:null],
        ["Membre depuis",fmtDate(detail.created_at)],
      ] as [string,string|null][]).map(([l,v])=><div key={l}><div style={{fontSize:12,color:"#667085"}}>{l}</div><div style={{fontWeight:600,wordBreak:"break-word"}}>{v||"—"}</div></div>)}</div>
      {detail.notes&&<div className="panel" style={{marginTop:14,marginBottom:0}}><div style={{fontSize:12,color:"#667085"}}>Notes</div><div>{detail.notes}</div></div>}

      {(detail.phone||detail.email)&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
        {detail.phone&&<a style={linkBtn} href={`tel:${detail.phone}`}><Phone size={16}/> Appeler</a>}
        {detail.phone&&<a style={linkBtn} href={waLink(detail.phone)} target="_blank" rel="noreferrer"><MessageCircle size={16}/> WhatsApp</a>}
        {detail.email&&<a style={linkBtn} href={`mailto:${detail.email}`}>E-mail</a>}
      </div>}

      {detail.status==="active"&&<>
      <h3 style={{margin:"22px 0 10px"}}>Participation</h3>
      {statsErr&&<div className="error-box">Historique indisponible. Recharge la page.</div>}
      {!statsErr&&!history&&<p className="muted">Chargement de l'historique…</p>}
      {history&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10}}>{[
          ["Présences",history.present,"#18794e"],
          ["Absences",history.absent,"#b42318"],
          ["Taux de présence",history.list.length?`${history.rate}%`:"—",history.list.length?rateColor(history.rate):"#667085"],
          ["Absences GOUDI d'affilée",history.streak,history.streak>=3?"#b42318":"#172033"],
        ].map(([l,v,c])=><div key={String(l)} style={{border:"1px solid #e6e8ec",borderRadius:12,padding:"10px 12px"}}><div style={{fontSize:12,color:"#667085"}}>{l}</div><div style={{fontSize:22,fontWeight:700,color:String(c)}}>{v}</div></div>)}</div>

        <h3 style={{margin:"20px 0 8px"}}>Historique des appels</h3>
        {!history.list.length&&<EmptyState compact icon="attendance" title="Aucun appel pour le moment"/>}
        {history.list.length>0&&<div style={{maxHeight:280,overflowY:"auto",border:"1px solid #e6e8ec",borderRadius:12}}><table><thead><tr><th>Date</th><th>Activité</th><th>Type</th><th>Statut</th></tr></thead><tbody>{history.list.map(x=><tr key={x.id}><td>{fmtDate(x.start)}</td><td>{x.name}</td><td><span className="badge">{x.typeName}</span></td><td><StatusBadge kind={x.status==="Présent"?"present":"absent"}/></td></tr>)}</tbody></table></div>}
      </>}
      </>}

      <div className="modal-actions" style={{flexWrap:"wrap"}}><button type="button" className="secondary" onClick={()=>setDetail(null)}>Fermer</button><button type="button" className="secondary" onClick={()=>setStatus(detail,detail.status==="active"?"inactive":"active")}>{detail.status==="active"?"Masquer (ancien membre)":"Réactiver"}</button><button type="button" className="secondary" onClick={()=>setCardOpen(true)}><QrCode size={16}/> Carte de membre</button><button type="button" className="primary" onClick={()=>startEdit(detail)}>Modifier</button></div>
      </>)}
    </div></div>}
    {detail&&cardOpen&&(()=>{
      const token=tokenOf(detail);
      const link=`${siteUrl()}/card/${token}`;
      const msg=`Salam ${detail.first_name}, voici ta carte de membre : ${link}\nPrésente le QR code à l'entrée.`;
      return <div className="modal-backdrop" onClick={()=>setCardOpen(false)}><div className="modal print-area" style={{width:"min(420px,100%)",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
        <div className="modal-head no-print"><h2>Carte de membre</h2><button type="button" className="icon-btn" onClick={()=>setCardOpen(false)}>×</button></div>
        {!token?<div className="error-box">Carte indisponible : lancez d'abord member_cards.sql dans Supabase.</div>:<>
          <MemberCardView firstName={detail.first_name} lastName={detail.last_name} memberNumber={detail.member_number} token={token} photoUrl={detail.photo_url}/>
          <p className="muted no-print" style={{fontSize:12,wordBreak:"break-all",margin:"12px 0"}}>{link}</p>
          <div className="no-print" style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
            {detail.phone&&<a className="primary" style={{textDecoration:"none"}} href={`${waLink(detail.phone)}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"><MessageCircle size={16}/> Envoyer par WhatsApp</a>}
            <button type="button" className="secondary" onClick={()=>navigator.clipboard.writeText(link).then(()=>alert("Lien copié"))}>Copier le lien</button>
            <button type="button" className="secondary" onClick={()=>window.print()}>Imprimer</button>
          </div>
          <button type="button" className="forgot-password no-print" style={{marginTop:14}} onClick={()=>regenerateCard(detail)}>Carte perdue ? Générer un nouveau QR</button>
        </>}
      </div></div>;
    })()}
  </>;
}