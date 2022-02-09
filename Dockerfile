FROM node:17.4.0-alpine
WORKDIR /usr/src/app
COPY . .
RUN yarn
RUN yarn build
CMD yarn start
