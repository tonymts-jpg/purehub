import { creators, posts } from "./data";
import { Post } from "./types";
import { ContentCategory } from "./categories";

export const mockRepository = {
  getFeed: (filters?:{category?:ContentCategory}) => filters?.category ? posts.filter(p=>p.category===filters.category) : posts,
  searchContent: (query:string,type:"post"|"creator"|"all"="all") => ({
    posts:type==="creator"?[]:posts.filter(p=>(p.title+p.excerpt+p.tags.join("")).toLowerCase().includes(query.toLowerCase())),
    creators:type==="post"?[]:creators.filter(c=>(c.name+c.handle+c.category).toLowerCase().includes(query.toLowerCase()))
  }),
  getPost:(id:string,custom:Post[]=[])=>[...custom,...posts].find(p=>p.id===id),
  getCreator:(handle:string)=>creators.find(c=>c.handle===handle)
};
