import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({ root: __dirname+"/..", plugins:[react(),tailwind()], server:{port:5199,strictPort:true} });
