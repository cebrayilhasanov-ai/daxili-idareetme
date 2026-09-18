import type {Metadata} from "next";import "./globals.css";
export const metadata:Metadata={title:"Daxili İdarəetmə",description:"Personal, tapşırıqlar, sənədlər və bildirişlər üçün daxili idarəetmə sistemi."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="az"><body>{children}</body></html>}
