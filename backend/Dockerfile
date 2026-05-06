FROM golang:1.25

WORKDIR /app

COPY . .

RUN go mod tidy

RUN echo "rebuild"

RUN go build -o main .

EXPOSE 8080

CMD ["./main"]