import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Hooka Relay — Every event. Delivered.',description:'Reliable webhook delivery with automatic retries, circuit breaking, and complete observability.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
