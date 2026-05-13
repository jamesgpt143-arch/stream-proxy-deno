FROM denoland/deno:alpine-1.39.1
WORKDIR /app
COPY . .
RUN deno cache main.ts
EXPOSE 10000
CMD ["run", "--allow-net", "--allow-env", "main.ts"]
