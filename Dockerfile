FROM node:15.7.0-alpine
WORKDIR /usr/src/app
COPY . .
RUN yarn
RUN yarn build
CMD yarn start
