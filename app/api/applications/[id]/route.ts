import {db} from '@/lib/db';
import {ownApplication,apiError,sameOrigin} from '@/lib/access';
import {newSecret} from '@/lib/security';
export async function GET(_req:Request,{params}:{params:{id:string}}){try{const app=await ownApplication(params.id);return Response.json({...app,endpoints:await db.endpoint.findMany({where:{applicationId:app.id},orderBy:{createdAt:'desc'}})});}catch(e){return apiError(e);}}
export async function POST(req:Request,{params}:{params:{id:string}}){try{sameOrigin(req);await ownApplication(params.id);return Response.json(await db.application.update({where:{id:params.id},data:{apiKey:'hr_live_'+newSecret()}}));}catch(e){return apiError(e);}}
