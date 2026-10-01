# SKYLINE AUCTION

Aplicação web para inscrições e sorteios de itens. Em desenvolvimento local, o estado compartilhado fica em `data.json`; em produção, use PostgreSQL por meio de `DATABASE_URL`. Cada navegador salva localmente o Nick informado para a próxima visita.

## Executar localmente

Requer Node.js 20 ou superior. Na pasta do projeto:

```sh
npm install
npm start
```

Abra `http://localhost:3000`. Para participantes em outros dispositivos na mesma rede, use `http://IP-DO-COMPUTADOR:3000` e permita conexões na rede local pelo firewall, se solicitado.

O catálogo inicial contém 22 itens e suas imagens em `assets/items/`. No painel administrativo, defina a quantidade e use **Salvar e publicar**; itens novos também são publicados ao salvar. Na primeira execução local, o terminal mostra um código temporário de configuração: informe-o no painel junto com a nova senha. O código muda se o servidor reiniciar antes da configuração.

## Segurança do primeiro acesso

Em produção, configure `ADMIN_SETUP_TOKEN` como um segredo aleatório de pelo menos 32 caracteres antes de criar a senha administrativa. O Blueprint do Render solicita esse valor como variável secreta. No primeiro acesso ao painel, informe o código e crie uma senha com pelo menos 12 caracteres. O código não substitui a senha e só é aceito enquanto ainda não houver senha configurada.

A senha administrativa é armazenada como hash com salt. As sessões expiram após 12 horas; tentativas de login e inscrições têm limitação por endereço de origem. Não compartilhe o código inicial nem a senha.

## Publicar no Render

1. Crie um banco PostgreSQL chamado `skyline-auction-db` no Render e escolha um plano apropriado para a retenção desejada.
2. Antes de iniciar o site hospedado, copie a **External Database URL** do banco para o terminal local e transfira os dados de `data.json`:

   ```powershell
   $env:DATABASE_URL = "COLE_A_EXTERNAL_DATABASE_URL_AQUI"
   $env:DATABASE_SSL = "true"
   npm run migrate:data
   Remove-Item Env:DATABASE_URL
   Remove-Item Env:DATABASE_SSL
   ```

   A migração transfere catálogo, inscrições, resultados e configuração administrativa. Se o banco já tiver dados, o comando cancela sem sobrescrevê-los. A conexão é usada localmente e não fica gravada no projeto.
3. Publique o projeto em um repositório privado no GitHub. `data.json`, `.env` e `node_modules` estão excluídos do Git; mantenha essas exclusões.
4. No Render, crie um **Blueprint** conectado ao repositório, defina um valor aleatório para `ADMIN_SETUP_TOKEN` e implante o serviço. O `render.yaml` conecta o site ao banco `skyline-auction-db`.
5. Abra a URL fornecida pelo Render e entre no painel com a senha administrativa já configurada no estado migrado. Se for uma instalação nova sem senha migrada, informe também o código `ADMIN_SETUP_TOKEN` para criar a senha.

O serviço usa uma instância para manter as gravações serializadas. Se outro provedor PostgreSQL exigir TLS, configure `DATABASE_SSL=true`; a validação do certificado permanece habilitada.

## Regras do leilão

Cada nome inscrito para um item aparece uma vez no sorteio, qualquer que seja a quantidade solicitada. O servidor embaralha os participantes com o gerador criptográfico do Node e distribui o estoque na ordem sorteada. Cada item só pode ser sorteado uma vez por edição.

Os ganhadores só são exibidos após o encerramento de todos os itens publicados. Ao preparar a edição seguinte, os resultados anteriores são apagados e as inscrições antigas ficam separadas da nova edição.

Não há contas individuais nem verificação de identidade. Portanto, o sistema não impede que alguém use o Nick de outra pessoa ou altere a própria inscrição com o mesmo Nick. A senha administrativa protege o painel de controle.
