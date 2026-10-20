import type {PinSessionClient} from './pinSession';
export function createProtectedFiles(session:Pick<PinSessionClient,'accessToken'|'onTokenChange'>,fetcher:typeof fetch=fetch){
  const urls=new Set<string>();let generation=0;
  const release=(url:string)=>{if(urls.delete(url))URL.revokeObjectURL(url);};
  const clear=()=>{generation++;for(const url of urls)URL.revokeObjectURL(url);urls.clear();};
  const unsubscribe=session.onTokenChange(token=>{if(!token)clear();});
  return{
    async read(query:string):Promise<string>{
      const token=session.accessToken(),version=generation;if(!token)throw Error('session-locked');
      const response=await fetcher('/api/files/read?'+query,{headers:{authorization:'Bearer '+token},credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('file-unavailable');
      const blob=await response.blob();
      if(version!==generation||!session.accessToken())throw Error('session-locked');
      const url=URL.createObjectURL(blob);urls.add(url);return url;
    },release,dispose(){clear();unsubscribe();}
  };
}
