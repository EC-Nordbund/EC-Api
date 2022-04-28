FROM node:17.4.0-alpine
WORKDIR /usr/src/app
COPY package.json yarn.lock ./
RUN yarn
COPY . .
RUN yarn build
CMD yarn start
