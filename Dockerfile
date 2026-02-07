# Use an official Node.js runtime as a parent image
FROM node:20-bookworm-slim

# Install build dependencies for node-pty
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install application dependencies using 'npm ci' for deterministic installs
RUN npm ci

# Copy the rest of the application source code to the working directory
COPY . .

# Make port 32352 available to the world outside this container
EXPOSE 32352

# Define the command to run your app
CMD ["node", "bin/cc-web.js"]
