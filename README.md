# Painel de Horas da Equipe

Aplicacao full stack para controle de horas por colaborador e por empresa.

## O que foi implementado

- Login com sessao no servidor.
- Banco de dados persistente do projeto.
- Relogio por empresa para cada colaborador.
- Visao semanal e mensal individual e da equipe.
- Relatorios com filtro por periodo, colaborador e empresa.
- Exportacao CSV.

## Como rodar

1. Instale as dependencias com `npm install`.
2. Inicie com `npm start`.
3. Abra `http://localhost:3000`.

## Publicar na Netlify

1. Envie este projeto para um repositorio Git.
2. No painel da Netlify, crie um novo site a partir desse repositorio.
3. Configure os parametros abaixo:
	- Build command: deixe em branco
	- Publish directory: `public`
	- Functions directory: `netlify/functions`
4. Crie a variavel de ambiente `SESSION_SECRET` com uma chave longa e aleatoria.
5. Faça o deploy.

### Observacoes da arquitetura Netlify

- O frontend continua estatico em `public/`.
- A API passa a rodar em Netlify Functions via `/.netlify/functions/api` com rewrite automatico de `/api/*`.
- Os dados compartilhados entre as maquinas passam a usar Netlify Blobs em producao.
- Em desenvolvimento local da Function, o projeto usa `data/netlify-store.json` como fallback para validar o fluxo sem depender da plataforma.

## Desenvolvimento local com Netlify

1. Instale as dependencias com `npm install`.
2. Rode `npm run netlify:dev`.
3. Abra o endereco exibido pela CLI da Netlify.

## Credenciais iniciais

- Usuario `ana` com senha `1234`
- Usuario `bruno` com senha `1234`
- Usuario `carla` com senha `1234`
- Usuario `diego` com senha `1234`
- Usuario `elisa` com senha `1234`
- Usuario `felipe` com senha `1234`
- Usuario `giovana` com senha `1234`
- Usuario `hugo` com senha `1234`