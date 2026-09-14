'use client';
import {useEffect,useState,useCallback} from 'react';
import {useRouter} from 'next/navigation';
import {Copy,Check,RefreshCw} from 'lucide-react';
export async function api<T=any>(url:string,body?:unknown):Promise<T>{const res=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Request failed');return data;}
export function useData<T>(url:string,poll=false){const [data,setData]=useState<T>();const [error,setError]=useState('');const router=useRouter();const load=useCallback(async()=>{try{setData(await api<T>(url));setError('');}catch(e){const msg=(e as Error).message;if(msg==='UNAUTHORIZED')router.replace('/login');else setError(msg);}},[url,router]);useEffect(()=>{load();if(poll){const timer=setInterval(load,5000);return()=>clearInterval(timer);}},[load,poll]);return {data,error,reload:load};}
export function Badge({value}:{value:string}){return <span className={`badge ${['OPEN','FAILED','TIMEOUT','DEAD_LETTERED'].includes(value)?'red':['HALF_OPEN','SKIPPED_CIRCUIT_OPEN','PENDING'].includes(value)?'amber':''}`}><span className="dot" style={{background:'currentColor'}}/>{value.replaceAll('_',' ')}</span>}
export function CopyButton({value}:{value:string}){const [copied,setCopied]=useState(false);return <button className="btn quiet" aria-label="Copy to clipboard" onClick={async()=>{await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),2000);}}>{copied?<Check size={14}/>:<Copy size={14}/>}</button>}
export function Refresh({onClick}:{onClick:()=>void}){return <button className="btn quiet" onClick={onClick}><RefreshCw size={13}/>Refresh</button>}
export function ErrorBox({error}:{error:string}){return error?<div className="error" role="alert">{error}</div>:null}
