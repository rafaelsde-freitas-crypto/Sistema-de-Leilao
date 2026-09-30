<<<<<<< HEAD
# SKYLINE AUCTION

Aplicação web para inscrições e sorteios de itens. Em desenvolvimento local, o estado compartilhado fica em `data.json`; em produção, use PostgreSQL por meio de `DATABASE_URL`. Cada navegador salva o Nick informado para a próxima visita.

## Executar

Requer Node.js 20 ou superior. No terminal, dentro desta pasta:

```sh
node server.mjs
```

Ou instale as dependências (`npm install`) e inicie com `npm start`.

Abra `http://localhost:3000`. Para participantes em outros dispositivos na mesma rede, abra `http://IP-DO-COMPUTADOR:3000` e permita a conexão pela rede local no firewall, se solicitado.

O catálogo inicial contém os 22 itens das imagens fornecidas. As imagens ficam em `assets/items/`. No painel administrativo, defina a quantidade de cada item e use **Salvar e publicar**; só então ele aparece para os participantes. Itens novos cadastrados pelo formulário também são publicados ao salvar. Os dados ficam em `data.json`.

## Publicar no Render

1. Crie um banco PostgreSQL chamado `skyline-auction-db` no Render. Para manter os dados, escolha um plano que não expire; o Postgres gratuito do Render expira após 30 dias. Veja [limitações do plano gratuito](https://render.com/docs/free).
2. Antes de iniciar o site hospedado, copie a **External Database URL** do banco para o terminal local e transfira o estado atual. No PowerShell:

   ```powershell
   $env:DATABASE_URL = "COLE_A_EXTERNAL_DATABASE_URL_AQUI"
   $env:DATABASE_SSL = "true"
   npm run migrate:data
   Remove-Item Env:DATABASE_URL
   Remove-Item Env:DATABASE_SSL
   ```

   O comando migra catálogo, inscrições, resultados e a configuração administrativa do `data.json` local diretamente para o banco. A conexão é usada localmente e não é gravada no projeto.
3. Publique o projeto em um repositório privado no GitHub. `data.json`, `.env` e `node_modules` estão excluídos do Git; não remova essas exclusões.
4. No Render, crie um **Blueprint** conectado ao repositório. O `render.yaml` configura o serviço Node e conecta ao banco existente chamado `skyline-auction-db`. Selecione uma região próxima ao banco.
5. Aguarde a implantação e abra a URL fornecida pelo Render. Entre no painel com a senha administrativa já configurada no estado migrado.

O serviço é configurado com uma instância para manter as gravações serializadas e consistentes. Para conectar outro provedor PostgreSQL, configure `DATABASE_URL`; defina `DATABASE_SSL=true` se o provedor exigir TLS.

## Administração

Antes de compartilhar o endereço com os participantes, abra **Área do administrador** e crie uma senha com pelo menos 12 caracteres. A senha é armazenada como hash com salt em `data.json`. Depois, o painel exige essa senha para exibir as inscrições, configurar e publicar itens ou realizar sorteios. A lista completa de participantes e os dados de inscrição não são enviados à página pública.

## Regra de chances

Cada nome inscrito para um item aparece uma vez no sorteio, qualquer que seja a quantidade pedida. O servidor embaralha os participantes com o gerador criptográfico do Node e percorre a ordem sorteada, atribuindo a cada pessoa até a quantidade solicitada, enquanto houver estoque. Cada item pode ser sorteado uma vez por edição. Quando o leilão é encerrado, o item fica com estoque zerado e deixa de aparecer na página pública; o administrador pode informar uma nova quantidade e publicar o mesmo item na próxima edição. Os resultados anteriores são preservados e identificados pelo número da edição.

Não há contas individuais nem verificação de identidade dos participantes. A senha administrativa protege o painel de controle.
=======
# Sistema-de-Leil-o
>>>>>>> ce2e78e3201c777a27fcac20cf3477c94b61eaaf
