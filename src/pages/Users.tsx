import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";
import type { Profile } from "../types";

export default function Users(){const [rows,setRows]=useState<Profile[]>([]);useEffect(()=>{supabase.from("profiles").select("*").order("created_at",{ascending:false}).then(({data})=>setRows((data as Profile[])||[]));},[]);return <><PageHeader title="Utilisateurs" description="Utilisateurs autorisés de la plateforme."/><div className="panel table-wrap"><table><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Statut</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td>{u.first_name} {u.last_name}</td><td>{u.email}</td><td><span className="badge">{u.role}</span></td><td>{u.is_active?"Actif":"Inactif"}</td></tr>)}</tbody></table></div></> }