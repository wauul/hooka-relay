import {z} from 'zod';
import {db} from '@/lib/db';
import {ownApplication,apiError,sameOrigin} from '@/lib/access';
import {newSecret,resolveEndpoint} from '@/lib/security';
export async function GET(_req:Request,{params}:{params:{id:string}}){try{await ownApplication(params.id);return Response.json(await db.endpoint.findMany({where:{applicationId:params.id}}));}catch(e){return apiError(e);}}
export async function POST(req:Request,{params}:{params:{id:string}}){try{sameOrigin(req);await ownApplication(params.id);const input=z.object({url:z.string().url().max(2000).optional(),mode:z.enum(['succeed','fail','hang','flaky']).optional(),eventTypes:z.array(z.string().min(1).max(120)).min(1).max(50).default(['*'])}).parse(await req.json());const url=input.mode?`${process.env.NEXTAUTH_URL}/api/fake-receiver/${input.mode}`:input.url;if(!url)throw new Error('URL required');await resolveEndpoint(url);return Response.json(await db.endpoint.create({data:{applicationId:params.id,url,eventTypes:input.eventTypes,secret:newSecret()}}),{status:201});}catch(e){return apiError(e);}}
