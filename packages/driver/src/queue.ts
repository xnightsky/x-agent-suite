/**
 * @module @x-agent-suite/driver/queue
 * 单生产者异步队列：push/fail/end 供生产侧，异步迭代供消费侧按序拉取。
 * 不变量：end/fail 之后 pending 中已排队的元素仍可被消费完；fail 之后所有后续迭代抛错。
 */

/** 异步迭代等待者。 */
interface Waiter<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: Error) => void;
}

/** 生产 → 消费的按序异步队列。 */
export class AsyncQueue<T> {
  private readonly pending: T[] = [];
  private readonly waiters: Waiter<T>[] = [];
  private ended = false;
  private failure: Error | null = null;

  /** 入队一个元素；end/fail 后入队显式抛错。 */
  push(item: T): void {
    if (this.ended || this.failure) {
      throw new Error("AsyncQueue 已结束，禁止继续 push");
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
      return;
    }
    this.pending.push(item);
  }

  /** 正常结束：剩余元素消费完后迭代 done。 */
  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined as never, done: true });
    }
  }

  /** 异常结束：剩余元素消费完后迭代抛错；无剩余则立即抛。 */
  fail(error: Error): void {
    if (this.ended || this.failure) {
      return;
    }
    this.failure = error;
    if (this.pending.length === 0) {
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(error);
      }
    }
  }

  /** 消费侧：按序异步迭代。 */
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      if (this.pending.length > 0) {
        const item = this.pending.shift() as T;
        yield item;
        continue;
      }
      if (this.failure) {
        throw this.failure;
      }
      if (this.ended) {
        return;
      }
      const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
      if (result.done) {
        if (this.failure) {
          throw this.failure;
        }
        return;
      }
      yield result.value;
    }
  }
}
